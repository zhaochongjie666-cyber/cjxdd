import { STAGES } from "../stages.ts";
import { XddRunnerState } from "../types.ts";
import type { XddStageName } from "../types.ts";
import { ControllerTestFixture } from "./controller-fixture.ts";

/** Explicit test-only state fixture for legacy XddRunnerState facade tests. */
export function createStateFixture(opts: { runId: string; cwd: string; userInput?: string }): XddRunnerState {
	const state = new XddRunnerState({ runId: opts.runId, cwd: opts.cwd, userInput: opts.userInput ?? "test" });
	state.plan = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	return state;
}

/** Initialize current stage through Controller START instead of direct facade writes. */
export function startStateFixture(state: XddRunnerState, stage: XddStageName = "init"): void {
	new ControllerTestFixture(state).startAt(stage);
}

/** Explicit test-only setup for facade read/serialization assertions. */
export function setStateFixturePlanIndex(state: XddRunnerState, planIndex: number): void {
	state.planIndex = planIndex;
}
