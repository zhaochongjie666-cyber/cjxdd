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
		compact?: (options?: { customInstructions?: string; onComplete?: (result: unknown) => void; onError?: (error: Error) => void }) => Promise<unknown> | unknown;
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
				case "COMPACT":
					await runCompactionEffect(effect.instructions, runtime);
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

async function runCompactionEffect(instructions: string, runtime: PiEffectRuntime): Promise<void> {
	const state = runtime.getState?.();
	let settled = false;
	const finish = async (success: boolean, error?: unknown): Promise<void> => {
		if (settled) return;
		settled = true;
		if (!success) {
			runtime.ctx.ui?.notify?.(`[xdd] compaction 失败：${error instanceof Error ? error.message : String(error ?? "unknown error")}`, "warning");
		}
		if (!state) return;
		try {
			const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
			const result = controller.dispatch({ type: "COMPACTION_DONE", success });
			await executePiEffects(result.effects, runtime);
		} catch (dispatchError) {
			// Completion callbacks run outside the original event handler in Pi.
			// Never let their failure become an uncaught exception in the session loop.
			runtime.ctx.ui?.notify?.(`[xdd] compaction 后续推进失败：${dispatchError instanceof Error ? dispatchError.message : String(dispatchError)}`, "warning");
		}
	};

	if (!runtime.ctx.compact) {
		await finish(false, new Error("Pi runtime does not provide ctx.compact"));
		return;
	}

	try {
		const result = runtime.ctx.compact({
			customInstructions: instructions,
			onComplete: () => { void finish(true); },
			onError: (error) => { void finish(false, error); },
		});
		// Pi 0.80.x starts compaction asynchronously and reports completion through
		// callbacks. Support promise-returning runtimes as well without claiming
		// completion before their compaction actually finishes.
		if (result && typeof (result as Promise<unknown>).then === "function") {
			await (result as Promise<unknown>).then(
				() => finish(true),
				(error) => finish(false, error),
			);
		}
	} catch (error) {
		await finish(false, error);
	}
}
