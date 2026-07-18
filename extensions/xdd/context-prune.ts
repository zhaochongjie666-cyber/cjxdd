import type { AgentMessage } from "@earendil-works/pi-coding-agent";

export const BASH_OUTPUT_STUB = "[bash 输出已压缩；命令仍保留在对应 tool call，结论见 stage summary 或 evidence 文件]";
export const TEXT_CONTENT_STUB = "[历史对话内容已压缩；xdd 状态以 .xdd/runtime.json、阶段产物和 stage summary 为准]";

const DEFAULT_CONTEXT_TEXT_BUDGET = 80_000;

const THINKING_CONTENT_TYPES = new Set(["thinking", "reasoning", "thought"]);

export interface ContextPruneOptions {
	/** Keep tool results at or after this assistant tool-call boundary intact. */
	currentTurnStartIndex?: number;
	/** Preserve at most this many text characters before replacing a bash result. */
	bashResultStubThreshold?: number;
	/** Keep total message text under this budget by stubbing oldest non-current text. */
	maxTotalTextChars?: number;
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
	const maxTotalTextChars = options.maxTotalTextChars ?? DEFAULT_CONTEXT_TEXT_BUDGET;
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
	if (Number.isFinite(maxTotalTextChars) && totalMessageTextLength(next) > maxTotalTextChars) {
		changed = pruneOldestTextInPlace(next, currentTurnStartIndex, maxTotalTextChars) || changed;
	}
	changed = neutralizeOrphanAnthropicToolResultsInPlace(next) || changed;
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
		Array.isArray(message?.toolCalls) && message.toolCalls.length > 0 ||
		hasContentPart(message, "tool_use");
}

function hasToolResults(message: any): boolean {
	return message?.role === "tool" ||
		message?.role === "tool_result" ||
		hasContentPart(message, "tool_result");
}

function hasContentPart(message: any, type: string): boolean {
	return Array.isArray(message?.content) && message.content.some((part: any) => part?.type === type);
}

function toolUseIds(message: any): Set<string> {
	const ids = new Set<string>();
	for (const call of message?.tool_calls ?? []) {
		if (call?.id) ids.add(String(call.id));
	}
	for (const call of message?.toolCalls ?? []) {
		if (call?.id) ids.add(String(call.id));
	}
	if (Array.isArray(message?.content)) {
		for (const part of message.content) {
			if (part?.type === "tool_use" && part.id) ids.add(String(part.id));
		}
	}
	return ids;
}

function contentToolResultIds(message: any): string[] {
	if (!Array.isArray(message?.content)) return [];
	return message.content
		.filter((part: any) => part?.type === "tool_result" && part.tool_use_id)
		.map((part: any) => String(part.tool_use_id));
}

function neutralizeOrphanAnthropicToolResultsInPlace(messages: AgentMessage[]): boolean {
	let changed = false;
	for (let index = 0; index < messages.length; index++) {
		const raw: any = messages[index];
		if (!Array.isArray(raw?.content)) continue;
		const resultIds = contentToolResultIds(raw);
		if (!resultIds.length) continue;
		const previous = messages[index - 1] as any;
		const previousToolUses = previous?.role === "assistant" ? toolUseIds(previous) : new Set<string>();
		let convertedOrphanText = "";
		const content = raw.content.flatMap((part: any) => {
			if (part?.type !== "tool_result" || !part.tool_use_id || previousToolUses.has(String(part.tool_use_id))) return [part];
			convertedOrphanText += `${convertedOrphanText ? "\n" : ""}${extractContentPartText(part)}`;
			changed = true;
			return [];
		});
		if (!convertedOrphanText) continue;
		const textPart = {
			type: "text",
			text: `[历史工具结果已转为普通文本；原 tool_result 缺少相邻 tool_use，避免提供商拒绝请求]\n${convertedOrphanText}`,
		};
		messages[index] = { ...raw, content: [...content, textPart] };
	}
	return changed;
}

function toolResultAsPlainTextMessage(raw: any): AgentMessage {
	return {
		...raw,
		role: "user",
		content: [{ type: "text", text: `[历史工具结果已转为普通文本；原 tool_result 缺少相邻 tool_use，避免提供商拒绝请求]\n${extractToolText(raw)}` }],
	};
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
	if (Array.isArray(content)) return content.map(extractContentPartText).join("\n");
	return String(content ?? "");
}

function extractContentPartText(part: any): string {
	if (typeof part === "string") return part;
	const content = part?.text ?? part?.content ?? "";
	return typeof content === "string" ? content : JSON.stringify(content) ?? String(content ?? "");
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

function totalMessageTextLength(messages: readonly AgentMessage[]): number {
	return messages.reduce((total, message) => total + extractMessageText(message).length, 0);
}

function extractMessageText(message: AgentMessage): string {
	const raw = message as any;
	return [extractToolText(message), raw.summary, raw.thinking, raw.reasoning, raw.thought]
		.filter((value) => typeof value === "string")
		.join("\n");
}

function pruneOldestTextInPlace(messages: AgentMessage[], currentTurnStartIndex: number, maxTotalTextChars: number): boolean {
	let total = totalMessageTextLength(messages);
	let changed = false;
	// Preserve current turn, tool-call/result pairing metadata, and the latest user instruction.
	const latestUserIndex = findLatestUserMessageIndex(messages);
	for (let index = 0; index < messages.length && total > maxTotalTextChars; index++) {
		if (index >= currentTurnStartIndex || index === latestUserIndex) continue;
		const before = extractMessageText(messages[index]).length;
		if (before <= TEXT_CONTENT_STUB.length) continue;
		const pruned = stubMessageText(messages[index]);
		if (pruned === messages[index]) continue;
		messages[index] = pruned;
		total -= before - extractMessageText(pruned).length;
		changed = true;
	}
	return changed;
}

function findLatestUserMessageIndex(messages: readonly AgentMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if ((messages[i] as any)?.role === "user") return i;
	}
	return -1;
}

function stubMessageText(message: AgentMessage): AgentMessage {
	const raw: any = message;
	if (raw?.role === "tool" || raw?.role === "tool_result") return stubToolResult(message);
	if (raw?.role === "assistant" && hasToolCalls(raw)) return stubStructuredContentText(raw);
	if (hasToolResults(raw)) return stubStructuredContentText(raw);
	if (raw?.role === "compactionSummary") return { ...raw, summary: TEXT_CONTENT_STUB };
	if ("content" in raw) return { ...raw, content: Array.isArray(raw.content) ? [{ type: "text", text: TEXT_CONTENT_STUB }] : TEXT_CONTENT_STUB };
	return message;
}

function stubStructuredContentText(raw: any): AgentMessage {
	if (!Array.isArray(raw.content)) return { ...raw, content: TEXT_CONTENT_STUB };
	let insertedTextStub = false;
	const content = raw.content.flatMap((part: any) => {
		const type = String(part?.type ?? "");
		if (type === "tool_use" || type === "tool_result") return [part];
		if (THINKING_CONTENT_TYPES.has(type)) return [];
		if (!insertedTextStub) {
			insertedTextStub = true;
			return [{ type: "text", text: TEXT_CONTENT_STUB }];
		}
		return [];
	});
	return { ...raw, content };
}
