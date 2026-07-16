import type { XddStageName } from "../types.ts";

export type HookPoint = "turn_start" | "before_tools" | "tool_use_done" | "turn_end";
export type HookAction = "pass" | "block" | "continue";

export interface HookToolCall {
	name: string;
	input?: unknown;
}

export interface HookPayload {
	hook: HookPoint;
	runId: string;
	stage: XddStageName | "?";
	stageEpoch: string;
	cwd: string;
	toolCalls?: HookToolCall[];
	toolResult?: unknown;
	turn?: unknown;
}

export interface HookOutput {
	action: HookAction;
	reason?: string;
	prompt?: string;
}

export interface HookExecutionRecord {
	file: string;
	output: HookOutput;
	stderr?: string;
	warning?: string;
	timedOut?: boolean;
}

export interface HookRunResult {
	action: HookAction;
	reason?: string;
	prompt?: string;
	records: HookExecutionRecord[];
	warnings: string[];
}

export const HOOK_POINTS: readonly HookPoint[] = ["turn_start", "before_tools", "tool_use_done", "turn_end"];
export const HOOK_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".py"]);
