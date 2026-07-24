/** NF 自包含 Pi 适配器：dispatch NfCommand + 执行 NfEffect。不依赖 xdd。 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { NfController } from "./core/controller.ts";
import type { NfCommand } from "./core/commands.ts";
import type { NfEffect } from "./core/effects.ts";
import { createNormalFlowRuntimeStore } from "./runtime-store.ts";
import { RuntimeStore } from "./storage/runtime-store.ts";
import type { NfRunnerState } from "./types.ts";

export interface NfEffectRuntime {
	pi: ExtensionAPI;
	steeringInput?: string;
	ctx: { ui?: { notify?: (text: string, level?: string) => unknown }; abort?: () => unknown; isIdle?: () => boolean; hasPendingMessages?: () => boolean };
	getState?: () => NfRunnerState | null | undefined;
}

export async function dispatchNfCommand(state: NfRunnerState, command: NfCommand, runtime: NfEffectRuntime): Promise<void> {
	const controller = new NfController(createNormalFlowRuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
	const result = controller.dispatch(command);
	await executeNfEffects(result.effects, runtime);
}

export function agentEndCommandFromPi(event: { messages?: Array<{ role?: string; stopReason?: string; errorMessage?: string }> }): NfCommand | null {
	const messages = event.messages ?? [];
	const last = messages[messages.length - 1];
	if (!last || last.role !== "assistant") return null;
	return { type: "AGENT_ENDED", stopReason: last.stopReason ?? "stop", providerError: last.errorMessage };
}

export async function executeNfEffects(effects: readonly NfEffect[], runtime: NfEffectRuntime): Promise<void> {
	for (const effect of effects) {
		try {
			switch (effect.type) {
				case "SEND_FOLLOWUP":
					await sendFollowUp(effect.text, effect.epoch, runtime, effect.delayMs);
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
					break;
			}
		} catch { /* best-effort */ }
	}
}

async function sendFollowUp(text: string, epoch: number, runtime: NfEffectRuntime, delayMs = 0): Promise<void> {
	const state = runtime.getState?.();
	if (state) { if (state.paused || state.stopRequested) return; if (state.continuationEpoch !== epoch) return; }
	if (runtime.ctx.hasPendingMessages?.()) return;
	if (delayMs > 0) { await sleep(delayMs); const s = runtime.getState?.(); if (s && (s.paused || s.stopRequested || s.continuationEpoch !== epoch)) return; }
	try {
		const input = runtime.steeringInput?.trim();
		const full = input ? `${text}\n\n${input}` : text;
		await runtime.pi.sendUserMessage?.(full, { deliverAs: "followUp" });
	} catch (error) {
		// 释放 continuation lock
		const state = runtime.getState?.();
		if (state) { try { new NfController(new RuntimeStore(state.cwd), state.plan.map(({ stage }) => stage)).dispatch({ type: "RELEASE_CONTINUATION", reason: error instanceof Error ? error.message : String(error) }); } catch { /* */ } }
	}
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
