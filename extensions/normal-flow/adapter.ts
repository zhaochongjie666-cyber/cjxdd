/**
 * NF 版的 Controller dispatch 适配器。跟 extensions/xdd/adapters/pi-controller.ts
 * 的 PiControllerAdapter 同样的职责（dispatch command -> 执行 effects），但会
 * 先把 effect 文案里 xdd 专属的品牌/工具名改写成 NF 的（见 xdd-text-bridge.ts）
 * 再执行。不能直接复用 PiControllerAdapter：它内部写死调用
 * `executePiEffects(result.effects, ...)`，没有给改写文案留口子，而且它总是
 * 用 `state.plan` 里的 stages 构造 Controller——这点其实和这里一致，因为
 * XddController 全程按传入的 stages 数组工作（见 Docs/normal-flow.md §3/§9.3）。
 */
import { XddController } from "../xdd/core/controller.ts";
import type { XddCommand } from "../xdd/core/commands.ts";
import type { XddEffect } from "../xdd/core/effects.ts";
import { createNormalFlowRuntimeStore } from "./runtime-store.ts";
import { executePiEffects, type PiEffectRuntime } from "../xdd/adapters/pi-effects.ts";
import type { XddRunnerState } from "../xdd/types.ts";
import { translateXddText } from "./xdd-text-bridge.ts";

function translateEffects(effects: readonly XddEffect[]): XddEffect[] {
	return effects.map((effect) => {
		if (effect.type === "SEND_FOLLOWUP" || effect.type === "NOTIFY") {
			return { ...effect, text: translateXddText(effect.text) };
		}
		return effect;
	});
}

/** dispatch 一个 XddCommand，并把返回的 effects（改写文案后）交给 Pi 执行。 */
export async function dispatchNfCommand(
	state: XddRunnerState,
	command: XddCommand,
	runtime: PiEffectRuntime,
): Promise<void> {
	const controller = new XddController(createNormalFlowRuntimeStore(state.cwd), state.plan.map(({ stage }) => stage));
	const result = controller.dispatch(command);
	await executePiEffects(translateEffects(result.effects), runtime);
}
