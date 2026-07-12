import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { buildActiveStageSystemPrompt } from "./context.ts";
import { renderReflectEnd, renderReflectStart, renderRollback, renderStageBoundary } from "./renderers.ts";
import { createXddTools } from "./tools/index.ts";
import type { XddRunnerState } from "./types.ts";

/**
 * Module-level shared state. The InlineExtension factory registers tools and
 * handlers that close over `stateRef`. runXdd injects the live state via
 * activateXddExtension(); when no run is active, stateRef is null and every
 * handler is a no-op (before_agent_start returns no override, context returns
 * messages unchanged) and every tool throws.
 */
let stateRef: XddRunnerState | null = null;

export function activateXddExtension(state: XddRunnerState): void {
	stateRef = state;
}

export function deactivateXddExtension(): void {
	stateRef = null;
}

function getState(): XddRunnerState {
	if (!stateRef) {
		throw new Error("[xdd] 无活跃 xdd run（state 未注入）");
	}
	return stateRef;
}

/**
 * xdd InlineExtension. Registered via main.ts extensionFactories (and
 * createHarness({ extensionFactories: [xddInlineExtension] }) in tests).
 *
 * Relies on the existing `agent.transformContext → runner.emitContext` wiring
 * (sdk.ts:359) to trigger `on("context")` each turn; it does NOT install any
 * transformContext bridge.
 */
export const xddInlineExtension: InlineExtension = {
	name: "xdd",
	factory(pi) {
		for (const tool of createXddTools(getState)) {
			pi.registerTool(tool);
		}

		pi.registerEntryRenderer("xdd_stage_boundary", renderStageBoundary);
		pi.registerEntryRenderer("xdd_reflect_start", renderReflectStart);
		pi.registerEntryRenderer("xdd_reflect_end", renderReflectEnd);
		pi.registerEntryRenderer("xdd_rollback", renderRollback);
		// xdd_ledger intentionally not rendered (audit only).

		// Disable auto-compaction for the duration of any xdd run.
		pi.on("session_before_compact", async () => {
			if (!stateRef) return undefined;
			return { cancel: true };
		});

		// Fresh per-stage system prompt.
		pi.on("before_agent_start", async () => {
			if (!stateRef) return undefined;
			const systemPrompt = buildActiveStageSystemPrompt(stateRef);
			return systemPrompt === undefined ? undefined : { systemPrompt };
		});

		// Fresh per-stage context: drop messages before the stage boundary.
		// During reflection this keeps the failed stage's own context (seed +
		// assistant + tool results), which is exactly what the model needs to
		// diagnose — instead of the entire run transcript.
		pi.on("context", async (event) => {
			if (!stateRef) return undefined;
			const start = Math.min(stateRef.boundary, event.messages.length);
			if (start <= 0) return undefined;
			return { messages: event.messages.slice(start) };
		});
	},
};
