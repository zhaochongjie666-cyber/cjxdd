import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { findStageGroup, isLastStageInGroup } from "../stage-groups.ts";
import { XddController } from "../core/controller.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";
import { evaluateStoredReviewVerdict } from "../review-verdict.ts";
import { evaluateCodeReviewGate } from "../code-review.ts";
import { evaluateReleaseDecisionGate } from "../release-decision.ts";

const schema = Type.Object({});

export function createXddAdvanceTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_advance",
		label: "xdd: advance to next stage",
		description:
			"推进 xdd 到下一阶段。前置：当前阶段须已调用 xdd_submit_artifact 并通过闸门。若为阶段组末尾阶段，会执行组级 Gate；非 verify 阶段失败时停留本阶段修复，只有 verify 可回跳流程。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) throw new Error("[xdd_advance] 无活跃阶段");
			const signals = state.getSignals();
			const passed = stage.exit === "verdict" ? signals.has("verdict_pass") : signals.has("complete");
			if (!passed) {
				return ok(
					`[xdd_advance] 当前阶段 ${stage.name} 尚未声明完成：请先调用 xdd_submit_artifact 并通过闸门，再调用 xdd_advance。`,
				);
			}
			if (stage.aiGate?.enabled !== false) {
				const review = evaluateStoredReviewVerdict(state.cwd, stage.name, {
					requireIndependentReviewer: true,
					requirePositivePathEvidence: true,
					requireFallbackAttackEvidence: true,
					allowOverrides: true,
				});
				if (!review.ok) {
					state.clearSignals();
					return ok(`[xdd_advance] ${stage.name} review verdict 已失效或不合规：${review.reasons.join("；")}。请重新提交产物并接受独立攻击审查。`);
				}
			}
			if (stage.name === "execute") {
				const codeReview = evaluateCodeReviewGate(state.cwd);
				if (!codeReview.ok) {
					state.clearSignals();
					return ok(`[xdd_advance] execute 只读 Code Review 未通过：${codeReview.reason}`);
				}
			}
			if (stage.name === "verify") {
				const release = evaluateReleaseDecisionGate(state.cwd);
				if (!release.ok) {
					return ok(`[xdd_advance] 最终 Release Decision 未通过：${release.reason}。请调用 xdd_release_decision 聚合并修复失败项。`);
				}
			}
			// Phase 2 (B): mark the stage as "passed, pending advance". agent_end
			// will set this to "advanced" only after the planIndex actually moves
			// (or to a different outcome if xdd_advance fails the group gate).
			// Resetting stageOutcome here would be wrong -- we don't know yet
			// whether the advance will succeed (group gate may fail).
			// Group gate check at group boundary. Failure -> rollback.
			// Success -> fall through to normal advance (auto, no human pause).
			let groupGateLabel: string | null = null;
			if (isLastStageInGroup(stage.name)) {
				const group = findStageGroup(stage.name);
				if (group) {
					const groupGate = await group.gate({
						cwd: state.cwd,
						summary: "",
						desiredState: [],
					});
					if (!groupGate.ok) {
						state.clearSignals();
						return ok(
							`[xdd_advance] 组级 ${group.gateLabel} 未通过，停留在 ${stage.name} 阶段修复；只有 verify 阶段允许 xdd_rollback 回跳流程：${groupGate.reason ?? "未知"}`,
						);
					}
					groupGateLabel = group.gateLabel;
				}
			}
			// Normal advance (group gate passed or non-boundary). Controller owns
			// planIndex/stageOutcome/pending approval/stageEpoch updates.
			const prevStageName = stage.name;
			const wouldBeNext = state.plan[state.planIndex + 1]?.stage;
			const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage: plannedStage }) => plannedStage));
			controller.dispatch({ type: "ADVANCE" });
			if (state.pendingGroupApproval) {
				return ok(
					`[xdd_advance] ${prevStageName} 阶段完成，产物已通过闸门。需要人类确认后才能进 ${wouldBeNext?.name ?? "下一阶段"}。输 /xdd continue 推进，或 /xdd rollback 回退。`,
				);
			}
			if (state.runComplete) {
				const prefix = groupGateLabel ? `${groupGateLabel} 通过 ✅，` : "";
				return { content: [{ type: "text", text: `[xdd_advance] ${prefix}最终阶段 ${stage.name} 通过，xdd run 完成 ✅。` }], details: {}, terminate: true };
			}
			const next = state.currentStage();
			const prefix = groupGateLabel ? `${groupGateLabel} 通过 ✅，` : "";
			const text = `[xdd_advance] ${prefix}${stage.name} 通过，进入下一阶段 ${next?.name ?? "?"}。`;
			// Do not terminate non-final turns: let Pi finish the agent loop so the
			// native queued follow-up lifecycle can deliver the next-stage instruction.
			return { content: [{ type: "text", text }] };
		},
	};
}
