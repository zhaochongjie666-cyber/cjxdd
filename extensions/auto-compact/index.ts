import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const DEFAULT_AUTO_COMPACT_THRESHOLD = 90;
export const MIN_AUTO_COMPACT_THRESHOLD = 1;
export const MAX_AUTO_COMPACT_THRESHOLD = 100;

export function parseAutoCompactThreshold(input: string): number | "off" | "status" | null {
	const value = input.trim().toLowerCase();
	if (!value || value === "status") return "status";
	if (value === "off") return "off";
	const match = /^(\d+(?:\.\d+)?)%?$/.exec(value);
	if (!match) return null;
	const threshold = Number(match[1]);
	if (threshold < MIN_AUTO_COMPACT_THRESHOLD || threshold > MAX_AUTO_COMPACT_THRESHOLD) return null;
	return threshold;
}

type CompactContext = Pick<ExtensionContext, "compact" | "getContextUsage" | "ui"> & Partial<Pick<ExtensionContext, "hasUI">>;

/** 将 Pi 的 callback 式内置压缩转换为 Promise，确保压缩完成后才进入本轮推理。 */
export function compactBeforeInference(ctx: CompactContext): Promise<void> {
	return new Promise((resolve, reject) => {
		ctx.compact({
			onComplete: () => resolve(),
			onError: (error) => reject(error),
		});
	});
}

export default function autoCompact(pi: ExtensionAPI) {
	let threshold = DEFAULT_AUTO_COMPACT_THRESHOLD;
	let enabled = true;
	let compacting: Promise<void> | null = null;

	pi.registerCommand("auto-compact", {
		description: "配置推理前自动上下文压缩：/auto-compact [1-100%|off|status]（默认 90%）",
		handler: async (args, ctx) => {
			const parsed = parseAutoCompactThreshold(args);
			if (parsed === null) {
				ctx.ui.notify("[auto-compact] 参数无效；请使用 1-100、off 或 status。", "error");
				return;
			}
			if (parsed === "off") enabled = false;
			else if (parsed !== "status") {
				threshold = parsed;
				enabled = true;
			}
			ctx.ui.notify(
				enabled ? `[auto-compact] 已启用，推理前阈值为 ${threshold}%` : "[auto-compact] 已关闭",
				"info",
			);
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!enabled) return;
		const percent = ctx.getContextUsage()?.percent;
		if (percent === null || percent === undefined || !Number.isFinite(percent) || percent < threshold) return;

		ctx.ui.notify(
			`[auto-compact] 上下文已达 ${percent.toFixed(1)}%（阈值 ${threshold}%），正在使用 Pi 内置压缩；完成后继续推理。`,
			"info",
		);
		compacting ??= compactBeforeInference(ctx).finally(() => {
			compacting = null;
		});
		try {
			await compacting;
			ctx.ui.notify("[auto-compact] 压缩完成，继续推理。", "info");
		} catch (error) {
			// 不吞掉失败：显式告警，同时让 Pi 自身的 overflow 兜底仍有机会处理本轮请求。
			ctx.ui.notify(
				`[auto-compact] 压缩失败，将交由 Pi 的上下文溢出机制兜底：${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		}
	});
}
