export interface AIGateProgressUi {
	notify(message: string, level: "info"): void;
}

const PROGRESS_INTERVAL_MS = 30_000;

/**
 * Keep slow AIGate calls visible to the user without adding messages to the
 * model context. `ui.notify` is rendered by Pi TUI only; unlike
 * `sendUserMessage`, it neither starts a turn nor participates in inference.
 */
export function startAIGateProgress(
	ui: AIGateProgressUi | undefined,
	stageName: string,
	now: () => number = Date.now,
	intervalMs = PROGRESS_INTERVAL_MS,
): () => void {
	if (!ui) return () => {};
	const startedAt = now();
	ui.notify(`[xdd] ${stageName}：AIGate 正在进行 AI 多角度审查，可能需要几分钟，请稍候…`, "info");
	const timer = setInterval(() => {
		const elapsedSeconds = Math.max(0, Math.round((now() - startedAt) / 1000));
		ui.notify(`[xdd] ${stageName}：AIGate 仍在审查中（已等待 ${elapsedSeconds} 秒）…`, "info");
	}, intervalMs);
	timer.unref?.();

	return () => {
		clearInterval(timer);
		const elapsedSeconds = Math.max(0, Math.round((now() - startedAt) / 1000));
		ui.notify(`[xdd] ${stageName}：AIGate 审查已返回（耗时 ${elapsedSeconds} 秒）。`, "info");
	};
}
