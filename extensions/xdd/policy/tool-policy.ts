import { applyStageBashPolicy } from "./bash-policy.ts";
import { checkStagePathAccess, type PathAccessKind } from "./path-policy.ts";
import type { XddRunnerState, XddStageSpec } from "../types.ts";

export interface ToolCallEventLike {
	toolName?: string;
	name?: string;
	input?: unknown;
}

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

export function enforceToolCallPolicy(state: XddRunnerState, event: ToolCallEventLike): void {
	const stage = state.currentStage();
	if (!stage) return;
	const toolName = String(event.toolName ?? event.name ?? "");
	if (!toolName) return;
	if (toolName.startsWith("xdd_") && !stage.allowedTools.includes(toolName)) {
		throw new Error(`[xdd policy] ${stage.name} 阶段不允许工具 ${toolName}；allowedTools=${stage.allowedTools.join(", ")}`);
	}
	if (toolName === "bash") {
		const input = ensureRecord(event.input);
		const violation = applyStageBashPolicy(stage, input as { command?: string; timeout?: number; description?: string });
		if (violation) throw new Error(`[xdd policy] 禁止的 bash 命令 (${violation.reason}): ${violation.command.slice(0, 160)}`);
		return;
	}
	if (READ_TOOLS.has(toolName)) {
		checkToolPaths(state.cwd, stage, event.input, "read", toolName);
		return;
	}
	if (WRITE_TOOLS.has(toolName)) {
		checkToolPaths(state.cwd, stage, event.input, "write", toolName);
	}
}

function checkToolPaths(cwd: string, stage: XddStageSpec, input: unknown, kind: PathAccessKind, toolName: string): void {
	const paths = extractPaths(input);
	for (const path of paths.length > 0 ? paths : ["."]) {
		const result = checkStagePathAccess(cwd, stage, path, kind);
		if (!result.ok) {
			throw new Error(`[xdd policy] ${stage.name}/${toolName}: ${result.reason}; allowedScopes=${(result.allowedScopes ?? []).join(", ")}`);
		}
	}
}

function extractPaths(input: unknown): string[] {
	const record = ensureRecord(input);
	const values = [record.path, record.file, record.filePath, record.dir, record.cwd, record.pattern, record.glob, record.paths, record.files].flat();
	return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function ensureRecord(input: unknown): Record<string, unknown> {
	if (input && typeof input === "object") return input as Record<string, unknown>;
	return {};
}
