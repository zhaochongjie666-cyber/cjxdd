import { RuntimeStore } from "../storage/runtime-store.ts";
import { STAGES } from "../stages.ts";
import { XddController } from "../core/controller.ts";
import type { XddCommand } from "../core/commands.ts";
import type { XddEffect } from "../core/effects.ts";
import type { RuntimeStateV2 } from "../storage/runtime-migrations.ts";
import type { XddStageSpec } from "../types.ts";

export interface HeadlessDispatchResult {
	state: RuntimeStateV2;
	effects: XddEffect[];
}

/**
 * Headless adapter for tests/scripts. It uses the same Controller Core as the
 * production Pi adapter, but records effects instead of calling Pi APIs.
 */
export class HeadlessXddController {
	readonly store: RuntimeStore;
	readonly controller: XddController;
	readonly effects: XddEffect[] = [];

	readonly cwd: string;

	constructor(cwd: string, stages: readonly XddStageSpec[] = STAGES) {
		this.cwd = cwd;
		this.store = new RuntimeStore(cwd);
		this.controller = new XddController(this.store, stages);
	}

	dispatch(command: XddCommand): HeadlessDispatchResult {
		const result = this.controller.dispatch(command);
		this.effects.push(...result.effects);
		return result;
	}

	load(): RuntimeStateV2 | undefined {
		return this.store.load();
	}
}
