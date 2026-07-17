import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { findStageGroup, isLastStageInGroup } from "../stage-groups.ts";
import { computeStageDifference, renderStageDifference } from "../stage-diff.ts";
import { XddController } from "../core/controller.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";
import { HarnessStore } from "../harness/store.ts";
import { buildAuditView, renderAuditView } from "../audit/projector.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";

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
				selfHealRemaining: state.stageSelfHealBudget(stage.name, "hard_gate").remaining,
				maxSelfHeal: state.maxSelfHealPerStage,
			});
			const hardBudget = state.stageSelfHealBudget(stage.name, "hard_gate");
			const aiBudget = state.stageSelfHealBudget(stage.name, "ai_gate");
			const failedBudget = state.stageOutcome === "ai_gate_failed" ? aiBudget : hardBudget;
			const groupGatePending = isLastStageInGroup(stage.name);
			const signals = state.getSignals();
			const hasComplete = signals.has("complete") || signals.has("verdict_pass");
			// Decide action based on diff results (NOT artifacts alone).
			let action: string;
			let gaps: string[];
			if (state.stageOutcome === "ai_gate_failed") {
				gaps = [`AIGate 未通过: ${state.lastStageError ?? "未知"}`];
				action = aiBudget.exhausted
					? (stage.name === "verify"
						? "verify 将自动消耗流程回退预算并回退到诊断出的缺陷阶段"
						: "AIGate 告警已软通过；调用 xdd_advance 推进")
					: `根据 AIGate 反馈修复后重新调 xdd_submit_artifact（剩余 AIGate 预算: ${aiBudget.remaining}）`;
			} else if (diff.gate.ok) {
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
			} else if (!failedBudget.exhausted) {
				gaps = [`硬 Gate 未通过: ${diff.gate.reason ?? "未知"}`];
				action = `修复产物后重新调 xdd_submit_artifact（剩余${failedBudget.kind === "ai_gate" ? " AIGate" : "硬 Gate"}预算: ${failedBudget.remaining}）`;
			} else {
				gaps = [`硬 Gate 未通过且自愈预算耗尽: ${diff.gate.reason ?? "未知"}`];
				action = stage.name === "verify"
					? `verify 预算耗尽会自动消耗流程回退预算并回退到诊断出的缺陷阶段`
					: `非 verify 阶段预算耗尽会软通过；调 xdd_advance 推进`;
			}
			const harnessCommands = new HarnessStore(state.cwd).load().验证命令;
			const runtime = new RuntimeStore(state.cwd).load() ?? state.toCheckpoint(state.status, state.rollbackCount) as never;
			const auditStatus = renderAuditView(buildAuditView(runtime));
			if (stage.name === "verify" && harnessCommands.length > 0 && !diff.gate.ok) {
				gaps.unshift(`优先运行 Harness 验证命令: ${harnessCommands.join(" && ")}`);
				action = `先运行 .xdd/harness.yml 中已确认的验证命令，并把结果写入 verify-report/evidence`;
			} else if (stage.name === "verify" && harnessCommands.length === 0) {
				gaps.unshift(".xdd/harness.yml 尚未配置 验证命令");
				action = `先用 xdd_harness_set 配置已确认的验证命令，再执行 verify`;
			}
			const group = findStageGroup(stage.name);
			new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage: plannedStage }) => plannedStage)).dispatch({
				type: "RECORD_AUDIT_EVENT",
				event: { type: "task_result", stage: stage.name, action, met: diff.metCount, unmet: diff.unmetCount },
			});
			const lines = [
				"[Controller 指令]",
				`阶段: ${stage.name}（${stage.role}）`,
				`下一步行动: ${action}`,
				`差距（${gaps.length} 项）:`,
				...gaps.map((g) => `  - ${g}`),
				`硬 Gate: ${diff.gate.ok ? "✓ pass" : "❌ " + (diff.gate.reason ?? "")}`,
				`desiredState 进度: ${diff.metCount} met / ${diff.unmetCount} unmet / ${diff.selfCheckCount} self-check`,
				`硬 Gate 自愈预算剩余: ${hardBudget.remaining}/${hardBudget.limit}`,
				`AIGate 自愈预算剩余: ${aiBudget.remaining}/${aiBudget.limit}`,
				stage.name === "verify" ? `Harness 验证命令: ${harnessCommands.length > 0 ? harnessCommands.join(" | ") : "未配置"}` : "",
				auditStatus,
				`组级 Gate 待执行: ${groupGatePending ? "是" : "否"}`,
				group ? `阶段组: ${group.label}` : "",
				"",
				"=== 完整 diff 输出 ===",
				renderStageDifference(diff, { artifacts, selfHealRemaining: hardBudget.remaining, maxSelfHeal: state.maxSelfHealPerStage }),
			].filter((s) => s !== "");
			return ok(lines.join("\n"));
		},
	};
}
