import type { XddEffect } from "../core/effects.ts";
import { projectAuditEvent } from "../audit/projector.ts";
import { XddController } from "../core/controller.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import type { XddRunnerState } from "../types.ts";

export interface PiEffectRuntime {
	pi: { sendUserMessage?: (text: string, options?: unknown) => Promise<unknown> | unknown };
	/** User instruction supplied with an xdd slash command, retained in its steering follow-up. */
	steeringInput?: string;
	ctx: {
		ui?: { notify?: (text: string, level?: string) => unknown };
		abort?: () => unknown;
		isIdle?: () => boolean;
		hasPendingMessages?: () => boolean;
	};
	getState?: () => XddRunnerState | null | undefined;
}

export async function executePiEffects(effects: readonly XddEffect[], runtime: PiEffectRuntime): Promise<void> {
	for (const effect of effects) {
		try {
			switch (effect.type) {
				case "SEND_FOLLOWUP":
					if (!await sendFollowUp(effect.text, effect.epoch, runtime, effect.delayMs)) continue;
					break;
				case "NOTIFY":
					runtime.ctx.ui?.notify?.(effect.text, effect.level);
					break;
				case "ABORT_AGENT":
					if (!runtime.ctx.isIdle?.()) runtime.ctx.abort?.();
					break;
				case "SET_ACTIVE_TOOLS":
				case "RUN_HOOK":
				case "APPEND_SESSION_ENTRY":
					// These are adapter capabilities that older pi versions may not expose.
					// Keep them explicit effects, but no-op until T6/T8/T11 wire concrete APIs.
					break;
			}
			recordEffectAudit(runtime, effect.type, "success");
		} catch (error) {
			recordEffectAudit(runtime, effect.type, "fail", error instanceof Error ? error.message : String(error));
			throw error;
		}
	}
}

async function sendFollowUp(text: string, epoch: number, runtime: PiEffectRuntime, delayMs = 0): Promise<boolean> {
	const state = runtime.getState?.();
	if (state) {
		if (state.paused || state.stopRequested) return true;
		if (state.continuationEpoch !== epoch) return true;
	}
	if (runtime.ctx.hasPendingMessages?.()) return true;
	if (delayMs > 0) {
		await sleep(delayMs);
		const latest = runtime.getState?.();
		if (latest) {
			if (latest.paused || latest.stopRequested) return true;
			if (latest.continuationEpoch !== epoch) return true;
		}
		if (runtime.ctx.hasPendingMessages?.()) return true;
	}
	try {
		await runtime.pi.sendUserMessage?.(appendSteeringInput(appendContinuationEpoch(text, epoch), runtime.steeringInput), { deliverAs: "followUp" });
		return true;
	} catch (error) {
		releaseContinuationLock(runtime, error);
		recordEffectAudit(runtime, "SEND_FOLLOWUP", "fail", error instanceof Error ? error.message : String(error));
		runtime.ctx.ui?.notify?.(`[xdd] followUp 发送失败，已释放 continuation lock：${error instanceof Error ? error.message : String(error)}`, "warning");
		return false;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendContinuationEpoch(text: string, epoch: number): string {
	if (!isXddAutoContinuationText(text)) return text;
	return /\[xdd epoch:\d+\]/.test(text) ? text : `${text}\n\n[xdd epoch:${epoch}]`;
}

function isXddAutoContinuationText(text: string): boolean {
	return text.startsWith("[xdd 自动推进]") || text.startsWith("[xdd 自动重试]") || text.startsWith("[xdd] 阶段") || text.startsWith("[xdd] 连续");
}

/** Keep an instruction typed after `/xdd-*` visible to the model that resumes work. */
export function appendSteeringInput(text: string, input?: string): string {
	const instruction = input?.trim();
	return instruction ? `${text}\n\n${instruction}` : text;
}

function releaseContinuationLock(runtime: PiEffectRuntime, error: unknown): void {
	const state = runtime.getState?.();
	if (!state) return;
	try {
		const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
		controller.dispatch({ type: "RELEASE_CONTINUATION", reason: error instanceof Error ? error.message : String(error) });
	} catch {
		// Best-effort recovery path: never let followUp delivery failures keep
		// the adapter throwing while the persisted continuation lock remains set.
	}
}

function recordEffectAudit(runtime: PiEffectRuntime, effect: XddEffect["type"], status: "success" | "fail", message?: string): void {
	const state = runtime.getState?.();
	if (!state) return;
	try {
		const store = new RuntimeStore(state.cwd);
		const rt = store.load();
		if (!rt) return;
		projectAuditEvent(rt, status === "success"
			? { type: "effect_success", effect, stage: state.currentStageName() ?? "?" }
			: { type: "effect_fail", effect, stage: state.currentStageName() ?? "?", message: message ?? "effect failed" });
		store.save(rt);
	} catch {
		// Audit must never break effect execution.
	}
}
