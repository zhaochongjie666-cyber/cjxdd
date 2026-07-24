/** NF 极简工具策略：只拦危险命令 + 阶段允许工具，不做写范围限制（vibe coding）。 */
import type { NfRunnerState } from "./types.ts";

const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /\bfind\s+\/\s*(?!-)/, reason: "find / 会扫描整个文件系统" },
	{ pattern: /\bfind\s+\/\s*-/, reason: "find /<args> 会扫描整个文件系统" },
	{ pattern: /\brm\s+(-[a-zA-Z]*\s+)*\/(?:\s*(?:-|$|\.)|[*?])/, reason: "rm -rf / 会删除整个系统" },
	{ pattern: /\bdd\s+if=\/dev\/(zero|urandom)\s+of=\/dev\//, reason: "dd 到设备会清空磁盘" },
	{ pattern: /\bmkfs(\.\w+)?\s+\/dev\//, reason: "mkfs 会格式化磁盘" },
];

export function enforceToolCallPolicy(state: NfRunnerState, event: { toolName?: string; name?: string; input?: unknown }): void {
	const stage = state.currentStage();
	if (!stage) return;
	const toolName = String(event.toolName ?? event.name ?? "");
	if (!toolName) return;
	if ((toolName.startsWith("nf_")) && !stage.allowedTools.includes(toolName)) {
		throw new Error(`[nf policy] ${stage.name} 阶段不允许工具 ${toolName}；allowedTools=${stage.allowedTools.join(", ")}`);
	}
	if (toolName === "bash") {
		const input = event.input as Record<string, unknown> ?? {};
		const cmd = String(input.command ?? "");
		for (const f of FORBIDDEN) { if (f.pattern.test(cmd)) throw new Error(`[nf policy] 禁止的 bash 命令 (${f.reason}): ${cmd.slice(0, 160)}`); }
	}
}
