import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { findStageGroup, isLastStageInGroup } from "../stage-groups.ts";
import { XddController } from "../core/controller.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

export function createXddAdvanceTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_advance",
		label: "xdd: advance to next stage",
		description:
			"推进 xdd 到下一阶段。前置：当前阶段须已调用 xdd_submit_artifact 并通过闸门。若为阶段组末尾阶段，会执行组级 Gate；失败则需 xdd_rollback 回退。",
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
						state.flowRollbackCount++; // Layer 2: group gate fail -> flow rollback
						// Phase 5 (E.4): atomically call goToStageName so the
						// rollback lands even if the agent never calls
						// xdd_rollback. We mark superseded ledger entries,
						// move planIndex, and stamp the new epoch -- all in one
						// step. The rollbackOutcome is also recorded for
						// downstream audit/notify.
						const from = stage.name;
						const to = group.rollbackTarget;
						const controller = new XddController(new RuntimeStore(state.cwd), state.plan.map(({ stage: plannedStage }) => plannedStage));
						controller.dispatch({
							type: "ROLLBACK",
							target: to,
							reason: `${group.gateLabel} 未通过：${groupGate.reason ?? "未知"}`,
						});
						return ok(
							`[xdd_advance] 组级 ${group.gateLabel} 未通过，强制回退 ${stage.name} -> ${group.rollbackTarget}：${groupGate.reason ?? "未知"}`,
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
			// Do NOT return terminate:true for non-final stages. terminate:true ends
			// the turn immediately, but the followUp from agent_end relies on
			// _handlePostAgentRun -> hasQueuedMessages, which can break when
			// auto-compaction triggers at high context usage (99%+). Without
			// terminate, the agent loop naturally ends the turn (no more tool
			// calls to make), and the followUp is picked up reliably.
			return { content: [{ type: "text", text }] };
		},
	};
}
