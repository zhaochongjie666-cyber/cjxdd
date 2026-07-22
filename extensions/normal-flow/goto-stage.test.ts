import { afterEach, describe, expect, it, vi } from "vitest";
import { XddRunnerState } from "./types.ts";
import { NF_STAGES } from "./stages.ts";
import { activateNormalFlowExtension, deactivateNormalFlowExtension, gotoNormalFlowStage } from "./extension.ts";

describe("Normal Flow stage navigation", () => {
	afterEach(() => deactivateNormalFlowExtension());

	it("jumps directly to framework and clears stale lifecycle state without steering", () => {
		const state = new XddRunnerState({ runId: "nf-goto", cwd: process.cwd(), userInput: "test" });
		state.plan = NF_STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
		state.paused = true;
		state.stopRequested = true;
		state.continuationQueued = true;
		state.lastStageError = "stale";
		activateNormalFlowExtension(state);
		const notify = vi.fn();

		gotoNormalFlowStage("architecture", notify);

		expect(state.currentStageName()).toBe("architecture");
		expect(state.status).toBe("running");
		expect(state.paused).toBe(false);
		expect(state.stopRequested).toBe(false);
		expect(state.continuationQueued).toBe(false);
		expect(state.lastStageError).toBeNull();
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("normal-flow-goto-framework"), "info");
	});

	it("warns and preserves the absence of state when no run is active", () => {
		const notify = vi.fn();
		gotoNormalFlowStage("architecture", notify);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("无活跃 Normal Flow run"), "warning");
	});
});
