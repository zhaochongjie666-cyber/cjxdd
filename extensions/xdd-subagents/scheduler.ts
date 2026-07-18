import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findXddSubagent, renderDelegationPrompt } from "./registry.ts";
import { artifactsRoot, XddSubagentRunStore, type XddSubagentRunMode, type XddSubagentRunRecord, type XddSubagentRunStatus } from "./runtime-store.ts";
import { resolvePiInvocation, type ResolvedPiInvocation } from "./settings.ts";
import { attachIntercomToRun, supervisorIntercomInstructions } from "./intercom.ts";
import { buildForkContext, renderForkContext } from "./fork-context.ts";
import { attachLease, heartbeatRun } from "./lease.ts";
import { appendSubagentEvent } from "./event-stream.ts";

export type XddSubagentRunParams = {
	mode?: XddSubagentRunMode;
	agent?: string;
	task?: string;
	tasks?: Array<{ agent: string; task: string }>;
	chain?: Array<{ agent: string; task: string }>;
	async?: boolean;
	model?: string;
	provider?: string;
	parentRunId?: string;
	thinking?: string;
	fallbackModels?: string[];
	modelScope?: string;
};

export type NormalizedSubagentTask = { agent: string; task: string };

export function normalizeRunParams(params: XddSubagentRunParams): { mode: XddSubagentRunMode; tasks: NormalizedSubagentTask[]; async: boolean; model?: string; provider?: string; parentRunId?: string; thinking?: string; fallbackModels?: string[]; modelScope?: string } {
	const mode = params.mode ?? (params.chain ? "chain" : params.tasks ? "parallel" : "single");
	const tasks = mode === "single"
		? [{ agent: params.agent ?? "", task: params.task ?? "" }]
		: mode === "parallel"
			? (params.tasks ?? [])
			: (params.chain ?? []);
	if (!tasks.length) throw new Error("至少需要一个 subagent task");
	for (const task of tasks) {
		if (!task.agent?.trim()) throw new Error("subagent task 缺少 agent");
		if (!task.task?.trim()) throw new Error(`subagent ${task.agent} 缺少 task`);
		if (!findXddSubagent(task.agent)) throw new Error(`未知 xdd subagent: ${task.agent}`);
	}
	return { mode, tasks, async: Boolean(params.async), model: params.model, provider: params.provider, parentRunId: params.parentRunId, thinking: params.thinking, fallbackModels: params.fallbackModels, modelScope: params.modelScope };
}

export function buildPiArgs(prompt: string, invocation: ResolvedPiInvocation = {}): string[] {
	const args = [];
	if (invocation.provider?.trim()) args.push("--provider", invocation.provider.trim());
	if (invocation.model?.trim()) args.push("--model", invocation.model.trim());
	if (invocation.thinking?.trim()) args.push("--thinking", invocation.thinking.trim());
	if (invocation.modelScope?.trim()) args.push("--model-scope", invocation.modelScope.trim());
	for (const fallback of invocation.fallbackModels ?? []) {
		if (fallback.trim()) args.push("--fallback-model", fallback.trim());
	}
	args.push("-p", prompt);
	return args;
}

function makeRun(cwd: string, normalized: ReturnType<typeof normalizeRunParams>): XddSubagentRunRecord {
	const now = new Date().toISOString();
	const id = `xddsa-${randomUUID()}`;
	const artifactDir = join(artifactsRoot(cwd), id);
	mkdirSync(artifactDir, { recursive: true });
	return attachLease({
		id,
		mode: normalized.mode,
		parentRunId: normalized.parentRunId,
		status: "queued",
		agents: normalized.tasks.map((task) => task.agent),
		tasks: normalized.tasks.map((task) => task.task),
		cwd,
		createdAt: now,
		updatedAt: now,
		artifactDir,
		transcriptPath: join(artifactDir, "run.log"),
		session: { id, parentId: normalized.parentRunId, resumeToken: `xdd-resume:${id}`, createdAt: now, updatedAt: now },
		chainOutputs: [],
		results: normalized.tasks.map((task, index) => ({ agent: task.agent, task: task.task, status: "queued", transcriptPath: join(artifactDir, `${index + 1}-${task.agent}.log`), artifactPath: join(artifactDir, `${index + 1}-${task.agent}.json`) })),
	});
}

async function spawnTask(cwd: string, run: XddSubagentRunRecord, index: number, invocation: ResolvedPiInvocation = {}, previousOutput?: string): Promise<string> {
	const task = run.results[index];
	const agent = findXddSubagent(task.agent);
	if (!agent) throw new Error(`未知 xdd subagent: ${task.agent}`);
	const inheritedContext = renderForkContext(buildForkContext(cwd, run, agent));
	const baseTask = `${inheritedContext}\n\n## Assigned Task\n${task.task}`;
	const taskTextBase = previousOutput ? `${baseTask}\n\n## Previous Structured Chain Output\n${previousOutput}` : baseTask;
	const taskText = run.intercomPath ? `${taskTextBase}\n\n${supervisorIntercomInstructions(run.intercomPath)}` : taskTextBase;
	const prompt = renderDelegationPrompt(agent, taskText);
	const resolvedInvocation = resolvePiInvocation(cwd, task.agent, invocation);
	writeFileSync(task.transcriptPath, `# ${task.agent}\n\n${prompt}\n\n--- output ---\n`);
	const child = spawn("pi", buildPiArgs(prompt, resolvedInvocation), { cwd, stdio: ["ignore", "pipe", "pipe"] });
	run.pid = child.pid;
	task.status = "running";
	appendSubagentEvent(cwd, { runId: run.id, type: "status", message: `task ${index + 1} ${task.agent} started` });
	touchRun(run, "running");
	child.stdout.on("data", (chunk) => appendFileSync(task.transcriptPath, chunk));
	child.stderr.on("data", (chunk) => appendFileSync(task.transcriptPath, chunk));
	await new Promise<void>((resolve) => {
		child.on("error", (error) => {
			task.status = "failed";
			task.error = error.message;
			appendFileSync(task.transcriptPath, `\n[spawn error] ${error.message}\n`);
			resolve();
		});
		child.on("close", (code) => {
			task.exitCode = code;
			task.status = code === 0 ? "succeeded" : "failed";
			resolve();
		});
	});
	const transcript = readFileSync(task.transcriptPath, "utf8");
	const summary = summarizeTranscript(transcript);
	task.summary = summary;
	if (task.artifactPath) writeFileSync(task.artifactPath, JSON.stringify({ index, agent: task.agent, status: task.status, transcriptPath: task.transcriptPath, summary, error: task.error }, null, 2) + "\n");
	return JSON.stringify({ index, agent: task.agent, status: task.status, transcriptPath: task.transcriptPath, artifactPath: task.artifactPath, summary, error: task.error }, null, 2);
}

function summarizeTranscript(transcript: string, max = 2000): string {
	const output = transcript.split("--- output ---").slice(1).join("--- output ---").trim() || transcript.trim();
	return output.length > max ? `${output.slice(0, max)}\n...[truncated]` : output;
}

function touchRun(run: XddSubagentRunRecord, status?: XddSubagentRunStatus): void {
	run.updatedAt = new Date().toISOString();
	if (run.session) run.session.updatedAt = run.updatedAt;
	if (status) run.status = status;
}

async function executeRun(cwd: string, store: XddSubagentRunStore, run: XddSubagentRunRecord, invocation: ResolvedPiInvocation = {}): Promise<XddSubagentRunRecord> {
	touchRun(run, "running");
	appendSubagentEvent(cwd, { runId: run.id, type: "status", message: "run started" });
	heartbeatRun(run);
	store.upsert(run);
	if (run.mode === "parallel") {
		await Promise.all(run.results.map((_task, index) => spawnTask(cwd, run, index, invocation).finally(() => store.upsert(run))));
	} else {
		let previousOutput = "";
		for (let index = 0; index < run.results.length; index += 1) {
			previousOutput = await spawnTask(cwd, run, index, invocation, run.mode === "chain" ? previousOutput : undefined);
			if (run.mode === "chain") run.chainOutputs = [...(run.chainOutputs ?? []), JSON.parse(previousOutput)];
			heartbeatRun(run);
			store.upsert(run);
			if (run.results[index].status !== "succeeded") break;
		}
	}
	const failed = run.results.find((task) => task.status === "failed");
	touchRun(run, failed ? "failed" : "succeeded");
	appendSubagentEvent(cwd, { runId: run.id, type: "status", message: `run ${run.status}`, data: { exitCode: failed ? 1 : 0 } });
	run.exitCode = failed ? 1 : 0;
	if (failed?.error) run.error = failed.error;
	writeFileSync(run.transcriptPath, run.results.map((task) => `${task.agent}: ${task.status} ${task.transcriptPath}`).join("\n") + "\n");
	store.upsert(run);
	return run;
}

export async function startXddSubagentRun(cwd: string, params: XddSubagentRunParams): Promise<XddSubagentRunRecord> {
	const normalized = normalizeRunParams(params);
	const store = new XddSubagentRunStore(cwd);
	const run = attachIntercomToRun(cwd, makeRun(cwd, normalized));
	store.upsert(run);
	appendSubagentEvent(cwd, { runId: run.id, type: "status", message: `created ${run.mode} run`, data: { agents: run.agents, parentRunId: run.parentRunId } });
	const promise = executeRun(cwd, store, run, { model: normalized.model, provider: normalized.provider, thinking: normalized.thinking, fallbackModels: normalized.fallbackModels, modelScope: normalized.modelScope });
	if (normalized.async) {
		void promise.catch((error) => {
			run.error = error instanceof Error ? error.message : String(error);
			touchRun(run, "failed");
			store.upsert(run);
		});
		return run;
	}
	return promise;
}
