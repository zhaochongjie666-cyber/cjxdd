import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { XddSubagent } from "./registry.ts";
import type { XddSubagentRunRecord } from "./runtime-store.ts";

export type ForkContext = {
	cwd: string;
	runId: string;
	agent: string;
	gitBranch?: string;
	gitStatus?: string;
	instructions: Array<{ path: string; text: string }>;
};

function safeGit(cwd: string, args: string[]): string | undefined {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

function findInstructionFiles(cwd: string): string[] {
	const files: string[] = [];
	let current = resolve(cwd);
	while (true) {
		const candidate = join(current, "AGENTS.md");
		if (existsSync(candidate)) files.unshift(candidate);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return files;
}

export function buildForkContext(cwd: string, run: XddSubagentRunRecord, agent: XddSubagent, maxInstructionBytes = 20000): ForkContext {
	const instructions = findInstructionFiles(cwd).map((path) => {
		const text = readFileSync(path, "utf8");
		return { path, text: text.length > maxInstructionBytes ? `${text.slice(0, maxInstructionBytes)}\n[AGENTS.md truncated by xdd-subagents]\n` : text };
	});
	return {
		cwd,
		runId: run.id,
		agent: agent.name,
		gitBranch: safeGit(cwd, ["branch", "--show-current"]),
		gitStatus: safeGit(cwd, ["status", "--short"]),
		instructions,
	};
}

export function renderForkContext(context: ForkContext): string {
	const parts = [
		"## Inherited Parent Context",
		`cwd: ${context.cwd}`,
		`runId: ${context.runId}`,
		`agent: ${context.agent}`,
		context.gitBranch ? `gitBranch: ${context.gitBranch}` : "gitBranch: unknown",
		"",
		"### git status --short",
		context.gitStatus || "<clean or unavailable>",
	];
	for (const instruction of context.instructions) {
		parts.push("", `### ${instruction.path}`, instruction.text);
	}
	parts.push("", "继承规则：遵守以上 AGENTS.md / git 状态 / cwd 约束；不要写 current_project/.pi。若上下文与用户任务冲突，优先用户任务和更深层 AGENTS.md。只在授权范围内行动。");
	return parts.join("\n");
}
