import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { observeFilesystem, renderFsSnapshot } from "../../xdd/observe-fs.ts";
import { HarnessStore } from "../../xdd/harness/store.ts";
import { type EmptyDetails, type GetNfState, ok } from "./index.ts";

const schema = Type.Object({});

/**
 * nf_observe：对齐 xdd_observe——内存簿记（阶段/进度/信号/产物/自愈预算）+ 真实
 * 文件系统观测（磁盘为准，不信任自报完成）。省掉了 xdd_observe 里 audit view /
 * @implements RXX 计数等更细的呈现，保留核心状态。
 */
export function createNfObserveTool(getState: GetNfState): ToolDefinition {
	return {
		name: "nf_observe",
		label: "normal-flow: observe current state",
		description:
			"Observe：返回当前 Normal Flow 状态全貌——内存簿记（阶段/进度/信号/产物/自愈预算）+ 真实文件系统观测。状态以磁盘为准，不信任自报完成。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) return ok("[nf_observe] 无活跃 run。");
			const signals = [...state.getSignals()].join(", ") || "(无)";
			const artifacts = state
				.getSubmittedArtifacts()
				.map((a) => `${a.stage}: [${a.paths.join(", ")}]`)
				.join(" ") || "(无)";
			const fsSnap = observeFilesystem(state.cwd, stage.deliverablePaths);
			const harnessCommands = new HarnessStore(state.cwd).load().验证命令;
			const lines = [
				`run: ${state.runId}`,
				`阶段: ${stage.name}（第 ${state.planIndex + 1}/${state.plan.length} 个，Normal Flow 3 阶段）`,
				`信号: ${signals}`,
				`产物闸门(任一): ${stage.deliverablePaths.length > 0 ? stage.deliverablePaths.join(", ") : "(软通过)"}`,
				`已提交产物: ${artifacts}`,
				`自愈预算(当前阶段): ${state.remainingSelfHealBudget(stage.name)}/${state.maxSelfHealPerStage}`,
				// flowRollbackLimitTier2 是目前唯一能读到 flowRollbackLimit 的访问器
				// （@deprecated，但没有非 deprecated 替代——只读展示，不受影响）。
				`Flow 回退预算: ${state.remainingFlowRollbackBudget()}/${state.flowRollbackLimitTier2}`,
				`验证命令: ${harnessCommands.length > 0 ? harnessCommands.join(" | ") : "未配置（scenarios/verify 阶段会自动探测 npm/go/make test）"}`,
				"",
				renderFsSnapshot(fsSnap),
			];
			return ok(lines.join("\n"));
		},
	};
}
