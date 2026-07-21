import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_AUTO_COMPACT_THRESHOLD = 90;
export const MIN_AUTO_COMPACT_THRESHOLD = 1;
export const MAX_AUTO_COMPACT_THRESHOLD = 100;

const DEFAULT_COMPACTION_INSTRUCTIONS = [
	"保留当前目标、已完成工作、关键决策、修改文件、测试结果、失败原因和下一步。",
	"保留工具调用与工具结果之间的对应关系；不要复制已经落盘的完整文档。",
].join("\n");

export function parseAutoCompactThreshold(input: string): number | "off" | "status" | null {
	const value = input.trim().toLowerCase();
	if (!value || value === "status") return "status";
	if (value === "off") return "off";
	const match = /^(\d+(?:\.\d+)?)%?$/.exec(value);
	if (!match) return null;
	const threshold = Number(match[1]);
	if (!Number.isFinite(threshold) || threshold < MIN_AUTO_COMPACT_THRESHOLD || threshold > MAX_AUTO_COMPACT_THRESHOLD) return null;
	return threshold;
}

type CompactContext = Pick<ExtensionContext, "compact" | "ui"> & Partial<Pick<ExtensionContext, "hasUI">>;

/** Check if an xdd or normal-flow run is active in the given directory. */
function hasActiveFlowRun(cwd: string): boolean {
	try {
		const runtimePath = join(cwd, ".xdd", "runtime.json");
		if (!existsSync(runtimePath)) return false;
		const raw = JSON.parse(readFileSync(runtimePath, "utf-8"));
		return raw?.status === "running";
	} catch {
		return false;
	}
}

/** Wrap Pi's callback API without treating ctx.compact's synchronous return as completion. */
export function triggerCompaction(ctx: CompactContext, customInstructions = DEFAULT_COMPACTION_INSTRUCTIONS): Promise<void> {
	return new Promise((resolve, reject) => {
		ctx.compact({
			customInstructions,
			onComplete: () => resolve(),
			onError: (error) => reject(error),
		});
	});
}

export default function autoCompact(pi: ExtensionAPI) {
	let thresholdPercent = DEFAULT_AUTO_COMPACT_THRESHOLD;
	let enabled = true;
	let thresholdReached = false;
	let compacting: Promise<void> | null = null;

	const startCompaction = async (ctx: CompactContext, customInstructions?: string): Promise<void> => {
		if (compacting) return compacting;
		if (ctx.hasUI !== false) ctx.ui.notify("[auto-compact] Compaction started", "info");
		compacting = triggerCompaction(ctx, customInstructions).finally(() => {
			compacting = null;
		});
		try {
			await compacting;
			if (ctx.hasUI !== false) ctx.ui.notify("[auto-compact] Compaction completed", "info");
		} catch (error) {
			if (ctx.hasUI !== false) {
				ctx.ui.notify(`[auto-compact] Compaction failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
		}
	};

	// Compact when context hits threshold — but only during an active xdd/nf flow.
	// Regular chat turns are excluded: Pi's own compaction handles those.
	pi.on("agent_end", async (_event, ctx) => {
		if (!enabled) return;
		const cwd = ctx.cwd ?? process.cwd();
		if (!hasActiveFlowRun(cwd)) return;
		const currentPercent = ctx.getContextUsage()?.percent ?? null;
		if (currentPercent === null || !Number.isFinite(currentPercent)) return;
		if (currentPercent < thresholdPercent) {
			thresholdReached = false;
			return;
		}
		if (thresholdReached) return;
		thresholdReached = true;
		await startCompaction(ctx);
	});

	pi.registerCommand("auto-compact", {
		description: "按模型上下文占用率配置 Pi 内置压缩：/auto-compact [1-100%|off|status]（默认 90%）",
		handler: async (args, ctx) => {
			const parsed = parseAutoCompactThreshold(args);
			if (parsed === null) {
				ctx.ui.notify("[auto-compact] 参数无效；请使用 1-100、off 或 status。", "error");
				return;
			}
			if (parsed === "off") enabled = false;
			else if (parsed !== "status") {
				thresholdPercent = parsed;
				thresholdReached = false;
				enabled = true;
			}
			ctx.ui.notify(enabled ? `[auto-compact] 已启用，阈值 ${thresholdPercent}%` : "[auto-compact] 已关闭", "info");
		},
	});

	pi.registerCommand("trigger-compact", {
		description: "立即调用 Pi 内置压缩，可在命令后附加自定义摘要指令",
		handler: async (args, ctx) => {
			await startCompaction(ctx, args.trim() || undefined);
		},
	});

	pi.registerTool({
		name: "compactandcontinue",
		label: "Compact & Continue",
		description: "触发 Pi 内置上下文压缩，然后继续 xdd flow。在 stage 结束时调用，压缩后返回继续指令让 AI 推进到下一阶段。",
		promptSnippet: "compactandcontinue — trigger Pi compaction and continue xdd flow",
		parameters: Type.Object({}),
		execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
			try {
				await startCompaction(ctx);
				return {
					content: [{ type: "text", text: "Compaction completed. Continue with the xdd flow — call xdd_desired_state to check the next stage requirements, then xdd_next_task to get the next task." }],
					details: { compacted: true },
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: `Compaction failed: ${error instanceof Error ? error.message : String(error)}. Continue anyway — call xdd_next_task to proceed.` }],
					details: { compacted: false, error: String(error) },
				};
			}
		},
	});
}
