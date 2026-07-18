import { mkdirSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { subagentsRoot } from "./runtime-store.ts";

export type SubagentEvent = { ts: string; runId: string; type: "status" | "message" | "heartbeat" | "diagnostic"; message: string; data?: unknown };

export function eventStreamPath(cwd: string): string { return join(subagentsRoot(cwd), "events.jsonl"); }

export function appendSubagentEvent(cwd: string, event: Omit<SubagentEvent, "ts">): SubagentEvent {
	const payload = { ...event, ts: new Date().toISOString() };
	const file = eventStreamPath(cwd);
	mkdirSync(dirname(file), { recursive: true });
	appendFileSync(file, `${JSON.stringify(payload)}\n`);
	return payload;
}

export function readSubagentEvents(cwd: string, limit = 50): SubagentEvent[] {
	const file = eventStreamPath(cwd);
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SubagentEvent).slice(-limit);
}
