import type { AgentMessage } from "@earendil-works/pi-coding-agent";

export const BASH_OUTPUT_STUB = "[bash 输出已压缩；命令仍保留在对应 tool call，结论见 stage summary 或 evidence 文件]";

const THINKING_CONTENT_TYPES = new Set(["thinking", "reasoning", "thought"]);

export interface ContextPruneOptions {
	/** Keep tool results at or after this assistant tool-call boundary intact. */
	currentTurnStartIndex?: number;
	/** Preserve at most this many text characters before replacing a bash result. */
	bashResultStubThreshold?: number;
}

export interface CompactionInstructionArgs {
	goal: string;
	stage: string;
	stageEpoch: string;
	modifiedFiles?: readonly string[];
	lastGateError?: string | null;
	unfinishedTasks?: readonly string[];
	harnessChanges?: readonly string[];
}

/**
 * Prune context without breaking provider tool-call invariants.
 *
 * The function never deletes messages. It only removes historical assistant
 * thinking payloads and stubs historical bash tool results, so every assistant
 * tool call still has its corresponding tool result message.
 */
export function pruneContextMessages(
	messages: readonly AgentMessage[],
	options: ContextPruneOptions = {},
): AgentMessage[] {
	const currentTurnStartIndex = options.currentTurnStartIndex ?? findCurrentToolTurnStart(messages);
	const threshold = options.bashResultStubThreshold ?? 2_000;
	let changed = false;
	const next = messages.map((message, index) => {
		let pruned = stripAssistantThinking(message);
		if (pruned !== message) changed = true;
		if (isHistoricalBashToolResult(pruned, index, currentTurnStartIndex) && toolResultTextLength(pruned) > threshold) {
			pruned = stubToolResult(pruned);
			changed = true;
		}
		return pruned;
	});
	return changed ? next as AgentMessage[] : messages as AgentMessage[];
}

/** Build compact instructions that tell pi's compactor what must survive. */
export function buildXddCompactionInstructions(args: CompactionInstructionArgs): string {
	const lines = [
		"[xdd compaction instructions]",
		`目标: ${args.goal}`,
		`当前阶段: ${args.stage}`,
		`stageEpoch: ${args.stageEpoch}`,
		"必须保留: 当前目标、阶段、已修改文件、Gate 失败原因、未完成任务、Harness 变化。",
		"不要复制整份设计正文；设计已落盘，只保留文件路径和关键决策索引。",
		"保持 assistant tool_call 与 tool result 配对，不要删除单侧工具消息。",
	];
	if (args.modifiedFiles?.length) lines.push(`已修改文件: ${args.modifiedFiles.join(", ")}`);
	if (args.lastGateError) lines.push(`Gate 失败原因: ${args.lastGateError}`);
	if (args.unfinishedTasks?.length) lines.push(`未完成任务: ${args.unfinishedTasks.join("; ")}`);
	if (args.harnessChanges?.length) lines.push(`Harness 变化: ${args.harnessChanges.join("; ")}`);
	return lines.join("\n");
}

/** Return latest assistant message index with tool calls; results after it are current turn. */
export function findCurrentToolTurnStart(messages: readonly AgentMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as any;
		if (message?.role === "assistant" && hasToolCalls(message)) return i;
	}
	return messages.length;
}

function hasToolCalls(message: any): boolean {
	return Array.isArray(message?.tool_calls) && message.tool_calls.length > 0 ||
		Array.isArray(message?.toolCalls) && message.toolCalls.length > 0;
}

function stripAssistantThinking(message: AgentMessage): AgentMessage {
	const raw = message as any;
	if (raw?.role !== "assistant") return message;
	let changed = false;
	const copy: any = { ...raw };
	for (const key of ["thinking", "reasoning", "thought"]) {
		if (key in copy) {
			delete copy[key];
			changed = true;
		}
	}
	if (Array.isArray(copy.content)) {
		const filtered = copy.content.filter((part: any) => !THINKING_CONTENT_TYPES.has(String(part?.type ?? "")));
		if (filtered.length !== copy.content.length) {
			copy.content = filtered;
			changed = true;
		}
	}
	return changed ? copy : message;
}

function isHistoricalBashToolResult(message: AgentMessage, index: number, currentTurnStartIndex: number): boolean {
	if (index >= currentTurnStartIndex) return false;
	const raw = message as any;
	if (raw?.role !== "tool" && raw?.role !== "tool_result") return false;
	const name = raw.name ?? raw.toolName ?? raw.tool_name;
	return name === "bash" || String(raw.tool_call_id ?? raw.toolCallId ?? "").includes("bash");
}

function toolResultTextLength(message: AgentMessage): number {
	return extractToolText(message).length;
}

function extractToolText(message: AgentMessage): string {
	const content = (message as any).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content.map((part: any) => typeof part === "string" ? part : part?.text ?? "").join("\n");
	}
	return String(content ?? "");
}

function stubToolResult(message: AgentMessage): AgentMessage {
	const raw: any = message;
	const copy: any = { ...raw };
	if (Array.isArray(raw.content)) {
		copy.content = [{ type: "text", text: BASH_OUTPUT_STUB }];
	} else {
		copy.content = BASH_OUTPUT_STUB;
	}
	if ("isError" in raw) copy.isError = raw.isError;
	return copy;
}
