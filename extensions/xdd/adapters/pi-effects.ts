import type { XddEffect } from "../core/effects.ts";
import type { XddRunnerState } from "../types.ts";

export interface PiEffectRuntime {
	pi: { sendUserMessage?: (text: string, options?: unknown) => Promise<unknown> | unknown };
	ctx: {
		ui?: { notify?: (text: string, level?: string) => unknown };
		abort?: () => unknown;
		isIdle?: () => boolean;
		hasPendingMessages?: () => boolean;
		compact?: (options?: unknown) => unknown;
	};
	getState?: () => XddRunnerState | null | undefined;
}

export async function executePiEffects(effects: readonly XddEffect[], runtime: PiEffectRuntime): Promise<void> {
	for (const effect of effects) {
		switch (effect.type) {
			case "SEND_FOLLOWUP":
				await sendFollowUp(effect.text, effect.epoch, runtime);
				break;
			case "NOTIFY":
				runtime.ctx.ui?.notify?.(effect.text, effect.level);
				break;
			case "ABORT_AGENT":
				if (!runtime.ctx.isIdle?.()) runtime.ctx.abort?.();
				break;
			case "COMPACT":
				runtime.ctx.compact?.({ instructions: effect.instructions });
				break;
			case "SET_ACTIVE_TOOLS":
			case "RUN_HOOK":
			case "APPEND_SESSION_ENTRY":
				// These are adapter capabilities that older pi versions may not expose.
				// Keep them explicit effects, but no-op until T6/T8/T11 wire concrete APIs.
				break;
		}
	}
}

async function sendFollowUp(text: string, epoch: number, runtime: PiEffectRuntime): Promise<void> {
	const state = runtime.getState?.();
	if (state) {
		if (state.paused || state.stopRequested) return;
		if (state.continuationEpoch !== epoch) return;
	}
	if (runtime.ctx.hasPendingMessages?.()) return;
	await runtime.pi.sendUserMessage?.(text, { deliverAs: "followUp" });
}
