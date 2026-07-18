import { existsSync, readFileSync } from "node:fs";
import { XddSubagentRunStore, type XddSubagentRunRecord } from "./runtime-store.ts";
import { startXddSubagentRun } from "./scheduler.ts";

export function buildChildWatchdogTask(run: XddSubagentRunRecord, maxTranscriptBytes = 60000): string {
	const transcripts = run.results.map((result) => {
		const text = existsSync(result.transcriptPath) ? readFileSync(result.transcriptPath, "utf8") : "<missing transcript>";
		const clipped = text.length > maxTranscriptBytes ? `${text.slice(0, maxTranscriptBytes)}\n[transcript truncated by child watchdog]\n` : text;
		return [`## Child task: ${result.agent}`, `status: ${result.status}`, `task: ${result.task}`, "```", clipped, "```"].join("\n");
	}).join("\n\n");
	return [
		"执行 xdd-subagents child watchdog 攻击检查。",
		"",
		`Run: ${run.id}`,
		`Mode: ${run.mode}`,
		`Status: ${run.status}`,
		"",
		"目标：只读审查 child run 的执行过程、输出、错误、遗漏验证和兜底缺口。不要修改文件。",
		"重点检查：",
		"- child 是否完成了 assigned task",
		"- 是否跳过验证、伪造成功或遗漏失败兜底",
		"- transcript 中是否有 blocker / need_decision / blocked 但父流程未处理",
		"- 是否需要回炉到 planner/worker/reviewer",
		"",
		transcripts,
	].join("\n");
}

export async function runChildWatchdog(cwd: string, runId: string, options: { async?: boolean; model?: string; maxTranscriptBytes?: number } = {}) {
	const run = new XddSubagentRunStore(cwd).find(runId);
	if (!run) return null;
	return startXddSubagentRun(cwd, {
		mode: "single",
		agent: "xdd-reviewer",
		task: buildChildWatchdogTask(run, options.maxTranscriptBytes),
		async: options.async ?? true,
		model: options.model,
	});
}
