import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { observeFilesystem, renderFsSnapshot } from "../observe-fs.ts";
import { HarnessStore } from "../harness/store.ts";
import { buildAuditView, renderAuditView } from "../audit/projector.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

/**
 * xdd_observe: Observe phase of the Controller cycle. Returns Current State from
 * BOTH the runner's in-memory bookkeeping AND the real filesystem (deliverable
 * files, checkpoint, @implements markers, .xdd spec/plan). The filesystem half
 * is the truth source - core.md principle 1 (State is SSOT) demands the state
 * be observed from reality, not from what the model self-reported.
 */
export function createXddObserveTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_observe",
		label: "xdd: observe current state",
		description:
		"Observe: 返回当前工程状态全貌（Current State）--内存簿记（阶段/进度/模式/信号/产物/自愈预算）+ 真实文件系统观测（阶段产物存在性/大小、checkpoint 可恢复、代码 @implements RXX 计数、.xdd spec RXX/feature、plan 任务勾选）。两半对照，状态以磁盘为准。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) return ok("[xdd_observe] 无活跃 run。");
			const attempts = state.plan
				.map((e) => `${e.stage.name}=${state.currentAttempt(e.stage.name)}`)
				.join(" ");
			const signals = [...state.getSignals()].join(", ") || "(无)";
			const artifacts = state
				.getSubmittedArtifacts()
				.map((a) => `${a.stage}: [${a.paths.join(", ")}]`)
				.join(" ") || "(无)";
			const selfAttacks =
				state.getSelfAttackNotes()
					.map(([s, n]) => `${s}: ${n.slice(0, 80)}`)
					.join(" ") || "(无)";
			const fsSnap = observeFilesystem(state.cwd, stage.deliverablePaths);
			const harnessCommands = new HarnessStore(state.cwd).load().验证命令;
			const runtime = new RuntimeStore(state.cwd).load() ?? state.toCheckpoint(state.status, state.rollbackCount) as never;
			const auditStatus = renderAuditView(buildAuditView(runtime));
			const lines = [
				`run: ${state.runId}`,
				`阶段: ${stage.name}（计划第 ${state.planIndex + 1}/${state.plan.length}）`,
				`模式: ${state.mode}`,
				`信号: ${signals}`,
				`产物闸门(任一): ${stage.deliverablePaths.length > 0 ? stage.deliverablePaths.join(", ") : "(软通过)"}`,
				`已提交产物: ${artifacts}`,
				`自我攻击记录: ${selfAttacks}`,
				`各阶段尝试次数: ${attempts}`,
				`自愈预算(当前阶段): ${state.remainingSelfHealBudget(stage.name)}/${state.maxSelfHealPerStage}`,
				`回退上限/阶段: ${state.maxRollbacksPerStage}`,
				`Harness 验证命令: ${harnessCommands.length > 0 ? harnessCommands.join(" | ") : "未配置"}`,
				auditStatus,
				"",
				renderFsSnapshot(fsSnap),
			];
			return ok(lines.join("\n"));
		},
	};
}
