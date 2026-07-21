import { XddController } from "../core/controller.ts";
import type { XddCommand } from "../core/commands.ts";
import type { XddArtifactSubmission } from "../types.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import type { XddRunnerState, XddStageName } from "../types.ts";
import { executePiEffects, type PiEffectRuntime } from "./pi-effects.ts";

export interface PiControllerAdapterOptions extends PiEffectRuntime {
	getState: () => XddRunnerState | null | undefined;
	ctx: PiEffectRuntime["ctx"];
}

export class PiControllerAdapter {
	private readonly options: PiControllerAdapterOptions;

	constructor(options: PiControllerAdapterOptions) {
		this.options = options;
	}

	async dispatch(command: XddCommand, steeringInput?: string): Promise<void> {
		const state = this.options.getState();
		if (!state) {
			if (command.type === "STOP") {
				this.options.ctx.ui?.notify?.("[xdd] 无活跃 xdd run。", "warning");
				return;
			}
			throw new Error(`[xdd] 无活跃 xdd run，无法处理 ${command.type}`);
		}
		const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
		const result = controller.dispatch(command);
		await executePiEffects(result.effects, { ...this.options, steeringInput });
	}
}

export function agentEndCommandFromPi(event: { messages?: Array<{ role?: string; stopReason?: string; errorMessage?: string }> }): XddCommand | null {
	const messages = event.messages ?? [];
	const last = messages[messages.length - 1];
	if (!last || last.role !== "assistant") return null;
	return {
		type: "AGENT_ENDED",
		stopReason: last.stopReason ?? "stop",
		providerError: last.errorMessage,
	};
}

export function submitCommandFromTool(submission: XddArtifactSubmission): XddCommand {
	return { type: "SUBMIT", submission };
}

export function advanceCommandFromTool(): XddCommand {
	return { type: "ADVANCE" };
}

export function rollbackCommandFromTool(target: XddStageName | undefined, reason: string): XddCommand {
	return { type: "ROLLBACK", target, reason };
}
