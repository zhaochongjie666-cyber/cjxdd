import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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

type ToolResultEvent = {
	type?: string;
	toolName?: string;
	name?: string;
	isError?: boolean;
	content?: Array<{ type?: string; text?: string }>;
};

/** Only a successful xdd_advance result is an xdd stage boundary. */
export function isXddStageEnd(event: ToolResultEvent): boolean {
	if (event.isError || String(event.toolName ?? event.name ?? "") !== "xdd_advance") return false;
	const text = (event.content ?? [])
		.filter((item) => item.type === "text")
		.map((item) => item.text ?? "")
		.join("\n");
	return text.includes("[xdd_advance]") && (
		text.includes("进入下一阶段")
		|| text.includes("最终阶段")
		|| text.includes("需要人类确认后才能进")
	);
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

	// A successful xdd_advance is the authoritative stage-end signal. Do not
	// compact at every turn boundary: one stage can legitimately span many turns.
	pi.on("tool_result", async (event, ctx) => {
		if (enabled && isXddStageEnd(event)) await startCompaction(ctx);
	});

	// Safety net for a long-running stage: Pi's agent boundary is a safe place to
	// inspect usage. If the configured model-window limit is reached before the
	// stage ends, compact now; xdd resumes through Pi's session_compact lifecycle.
	pi.on("agent_end", async (_event, ctx) => {
		const currentPercent = ctx.getContextUsage()?.percent ?? null;
		if (!enabled || currentPercent === null || !Number.isFinite(currentPercent)) return;
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
}
