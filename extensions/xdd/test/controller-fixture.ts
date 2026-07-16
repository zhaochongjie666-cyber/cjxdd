import { XddController } from "../core/controller.ts";
import type { XddCommand } from "../core/commands.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import { STAGES } from "../stages.ts";
import type { XddRunnerState, XddStageName } from "../types.ts";

/**
 * Controller-backed state setup for production-flow tests.
 *
 * Tests should use this instead of directly writing planIndex/stageOutcome so
 * fixtures keep exercising the same transition path as production.
 */
export class ControllerTestFixture {
	readonly controller: XddController;
	readonly state: XddRunnerState;

	constructor(state: XddRunnerState) {
		this.state = state;
		this.controller = new XddController(new RuntimeStore(state.cwd), STAGES);
	}

	dispatch(command: XddCommand): void {
		this.controller.dispatch(command);
	}

	startAt(stage: XddStageName = "init"): void {
		this.dispatch({
			type: "START",
			task: this.state.userInput,
			options: { cwd: this.state.cwd, runId: this.state.runId, initialStage: stage },
		});
	}

	submitGatePassed(): void {
		this.dispatch({
			type: "SUBMIT",
			submission: { summary: "test gate passed", artifacts: [], selfAttack: "fixture checked", pass: true },
		});
	}

	advance(): void {
		this.dispatch({ type: "ADVANCE" });
	}

	startAdvancedAt(stage: XddStageName): void {
		const idx = STAGES.findIndex((entry) => entry.name === stage);
		if (idx <= 0) throw new Error(`cannot advance into ${stage} from an earlier stage`);
		this.startAt(STAGES[idx - 1].name);
		this.submitGatePassed();
		this.advance();
	}
}
