import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { findStageGroup, isLastStageInGroup } from "../stage-groups.ts";
import { computeStageDifference, renderStageDifference } from "../stage-diff.ts";
import { XddController } from "../core/controller.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

export function createXddNextTaskTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_next_task",
		label: "xdd: next task",
		description:
			"Reconcile: Controller 返回唯一下一步 Task（基于 Difference 计算）。Agent 通过此工具接收控制指令。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) return ok("[xdd_next_task] 无活跃 run。");
			// Phase 8 (H.1): the action decision must come from
			// computeStageDifference (real filesystem + desiredState
			// classification), not from a guess based on signals /
			// artifacts alone. computeStageDifference calls the stage's
			// REAL hard gate and observes the disk; the result drives the
			// controller instruction.
			const artifacts = state.getSubmittedArtifactsForStage(stage.name) ?? [];
			const diff = await computeStageDifference(state.cwd, stage, {
				artifacts,
				selfHealRemaining: state.remainingSelfHealBudget(stage.name),
				maxSelfHeal: state.maxSelfHealPerStage,
			});
			const remaining = state.remainingSelfHealBudget(stage.name);
			const groupGatePending = isLastStageInGroup(stage.name);
			const signals = state.getSignals();
			const hasComplete = signals.has("complete") || signals.has("verdict_pass");
			// Decide action based on diff results (NOT artifacts alone).
			let action: string;
			let gaps: string[];
			if (diff.gate.ok) {
				if (hasComplete) {
					gaps = [];
					action = `调用 xdd_advance 推进到下一阶段`;
				} else {
					// Gate OK but signal not set: agent likely forgot to
					// call xdd_submit_artifact. Point it back.
					gaps = ["硬 Gate 已通过但 xdd_submit_artifact 未记录 complete 信号"];
					action = `调 xdd_submit_artifact 重新提交（这一次会通过 Gate）`;
				}
			} else if (diff.unmetCount > 0) {
				// Hard unmet desiredState items: the agent hasn't done the
				// work yet. List the unmet items as the gap.
				gaps = diff.checks.filter((c) => c.status === "unmet").map((c) => c.item);
				action = `按 desiredState 执行 ${stage.name} 阶段工作（${diff.unmetCount} 项未完成）`;
			} else if (remaining > 0) {
				gaps = [`硬 Gate 未通过: ${diff.gate.reason ?? "未知"}`];
				action = `修复产物后重新调 xdd_submit_artifact（剩余预算: ${remaining}）`;
			} else {
				gaps = [`硬 Gate 未通过且自愈预算耗尽: ${diff.gate.reason ?? "未知"}`];
				action = `调 xdd_diagnose 诊断根因，或 xdd_rollback 回退到设计层修复后重跑`;
			}
			const group = findStageGroup(stage.name);
			new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage: plannedStage }) => plannedStage)).dispatch({
				type: "RECORD_ESG",
				nodeType: "task",
				stage: stage.name,
				label: `next task: ${action}（diff met=${diff.metCount} unmet=${diff.unmetCount}）`,
			});
			const lines = [
				"[Controller 指令]",
				`阶段: ${stage.name}（${stage.role}）`,
				`下一步行动: ${action}`,
				`差距（${gaps.length} 项）:`,
				...gaps.map((g) => `  - ${g}`),
				`硬 Gate: ${diff.gate.ok ? "✓ pass" : "❌ " + (diff.gate.reason ?? "")}`,
				`desiredState 进度: ${diff.metCount} met / ${diff.unmetCount} unmet / ${diff.selfCheckCount} self-check`,
				`自愈预算剩余: ${remaining}`,
				`组级 Gate 待执行: ${groupGatePending ? "是" : "否"}`,
				group ? `阶段组: ${group.label}` : "",
				"",
				"=== 完整 diff 输出 ===",
				renderStageDifference(diff, { artifacts, selfHealRemaining: remaining, maxSelfHeal: state.maxSelfHealPerStage }),
			].filter((s) => s !== "");
			return ok(lines.join("\n"));
		},
	};
}
