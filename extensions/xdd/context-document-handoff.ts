import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-coding-agent";
import { resolveGlobs } from "./glob-resolver.ts";
import type { ArtifactRule, XddStageName } from "./types.ts";

const DESIGN_DOCUMENT_HANDOFF_STAGES = new Set<XddStageName>(["understand", "spec", "architecture", "wire", "resilience"]);
const DEFAULT_MAX_DOCUMENT_CHARS = 30_000;
const DEFAULT_MAX_CHARS_PER_FILE = 6_000;

export interface DocumentHandoffOptions {
	maxDocumentChars?: number;
	maxCharsPerFile?: number;
}

export function shouldUseDocumentHandoff(stage: XddStageName): boolean {
	return DESIGN_DOCUMENT_HANDOFF_STAGES.has(stage);
}

/**
 * For design stages, add the stage's document inputs without deleting chat/tool
 * history. Pi owns semantic compaction; xdd may enrich context, but must not
 * directly erase remembered conversation state.
 */
export async function buildDocumentHandoffMessages(args: {
	cwd: string;
	stage: XddStageName;
	inputs?: readonly ArtifactRule[];
	messages: readonly AgentMessage[];
	options?: DocumentHandoffOptions;
}): Promise<AgentMessage[]> {
	if (!shouldUseDocumentHandoff(args.stage)) return args.messages as AgentMessage[];
	const docContext = await readDocumentContext(args.cwd, args.inputs ?? [], args.options);
	if (!docContext) return args.messages as AgentMessage[];
	const latestUser = findLatestUserMessage(args.messages);
	const handoff: AgentMessage = {
		role: "user",
		content: `[xdd document handoff] ${args.stage} 阶段补充落盘文档上下文；不删除历史对话/工具消息，语义压缩仅由 Pi compaction 负责。以下是本阶段输入文档摘录，若信息不足请重新 read 对应文件。\n\n${docContext}`,
	} as AgentMessage;
	if (!latestUser) return [...args.messages, handoff] as AgentMessage[];
	const latestUserIndex = args.messages.lastIndexOf(latestUser);
	return [
		...args.messages.slice(0, latestUserIndex),
		handoff,
		...args.messages.slice(latestUserIndex),
	] as AgentMessage[];
}

async function readDocumentContext(cwd: string, inputs: readonly ArtifactRule[], options: DocumentHandoffOptions = {}): Promise<string> {
	const maxDocumentChars = options.maxDocumentChars ?? DEFAULT_MAX_DOCUMENT_CHARS;
	const maxCharsPerFile = options.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE;
	const patterns = inputs.map((input) => input.pattern);
	if (!patterns.length) return "";
	const paths = await resolveInputPaths(cwd, patterns);
	let remaining = maxDocumentChars;
	const sections: string[] = [];
	for (const path of paths) {
		if (remaining <= 0) break;
		const abs = join(cwd, path);
		if (!existsSync(abs) || !statSync(abs).isFile()) continue;
		const raw = readFileSync(abs, "utf8");
		const take = Math.min(raw.length, maxCharsPerFile, remaining);
		const suffix = raw.length > take ? "\n...[truncated]" : "";
		const section = `## ${path}\n${raw.slice(0, take)}${suffix}`;
		sections.push(section);
		remaining -= section.length;
	}
	return sections.join("\n\n");
}

async function resolveInputPaths(cwd: string, patterns: readonly string[]): Promise<string[]> {
	const resolved = resolveGlobs(cwd, patterns);
	return [...new Set(resolved)].sort();
}

function findLatestUserMessage(messages: readonly AgentMessage[]): AgentMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if ((messages[i] as any)?.role === "user") return messages[i] as AgentMessage;
	}
	return undefined;
}
