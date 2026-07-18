import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { subagentsRoot, XddSubagentRunStore, type XddSubagentRunRecord } from "./runtime-store.ts";

export type IntercomMessage = {
	ts: string;
	runId: string;
	direction: "supervisor_to_child" | "child_to_supervisor";
	reason: "need_decision" | "progress_update" | "blocked" | "note";
	message: string;
};

export function intercomPath(cwd: string, runId: string): string {
	return join(subagentsRoot(cwd), "intercom", `${runId}.jsonl`);
}

export function supervisorIntercomInstructions(path: string): string {
	return [
		"## Supervisor Intercom",
		"如果你需要向父会话请求决策、报告阻塞或发送重要进展，把 JSONL 追加到下面文件：",
		path,
		"每行 JSON schema: {\"direction\":\"child_to_supervisor\",\"reason\":\"need_decision|progress_update|blocked|note\",\"message\":\"...\"}",
		"只有确实需要父会话介入时才写；常规完成请直接在最终回答中汇报。",
	].join("\n");
}

export function appendIntercomMessage(filePath: string, message: IntercomMessage): void {
	mkdirSync(dirname(filePath), { recursive: true });
	appendFileSync(filePath, `${JSON.stringify(message)}\n`);
}

export function postSupervisorMessage(cwd: string, runId: string, message: string, reason: IntercomMessage["reason"] = "note"): IntercomMessage {
	const payload: IntercomMessage = { ts: new Date().toISOString(), runId, direction: "supervisor_to_child", reason, message };
	appendIntercomMessage(intercomPath(cwd, runId), payload);
	return payload;
}

export function readIntercomMessages(cwd: string, runId: string): IntercomMessage[] {
	const filePath = intercomPath(cwd, runId);
	if (!existsSync(filePath)) return [];
	return readFileSync(filePath, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as IntercomMessage);
}

export function attachIntercomToRun(cwd: string, run: XddSubagentRunRecord): XddSubagentRunRecord {
	run.intercomPath = intercomPath(cwd, run.id);
	new XddSubagentRunStore(cwd).upsert(run);
	return run;
}
