import { XddSubagentRunStore, type XddSubagentRunRecord } from "./runtime-store.ts";
import { buildRunTree, renderRunTree } from "./lineage.ts";

export type ResumePlan = { run?: XddSubagentRunRecord; resumable: boolean; prompt: string; tree: string };

export function buildResumePlan(cwd: string, id: string): ResumePlan {
	const store = new XddSubagentRunStore(cwd);
	const runs = store.load().runs;
	const run = runs.find((entry) => entry.id === id);
	const tree = renderRunTree(buildRunTree(runs));
	if (!run) return { resumable: false, prompt: `未找到 run: ${id}`, tree };
	const failed = run.results.filter((task) => task.status === "failed" || task.status === "stopped");
	const pending = run.results.filter((task) => task.status === "queued" || task.status === "running");
	const previous = (run.chainOutputs ?? []).map((output) => JSON.stringify(output, null, 2)).join("\n");
	const prompt = [
		"# Resume xdd subagent session",
		`runId: ${run.id}`,
		`resumeToken: ${run.session?.resumeToken ?? `xdd-resume:${run.id}`}`,
		`status: ${run.status}`,
		`mode: ${run.mode}`,
		"",
		"## Session Tree",
		tree || "(empty)",
		"",
		"## Structured Previous Outputs",
		previous || "(none)",
		"",
		"## Recovery Targets",
		[...failed, ...pending].map((task) => `- ${task.agent}: ${task.status} ${task.task}${task.sessionId ? ` (Pi session: ${task.sessionId})` : " (legacy run: no Pi session)"}`).join("\n") || "- 无失败或未完成任务；只需总结结果。",
	].join("\n");
	return { run, resumable: run.status !== "succeeded", prompt, tree };
}
