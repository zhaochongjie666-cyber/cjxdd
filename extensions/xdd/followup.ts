/**
 * Phase 1 P25 + Phase 2: decide what followUp to send based on
 * XddStageOutcome. Single source of truth for the auto-continue
 * scheduler. Returns null when no followUp is needed.
 *
 * Extracted from extension.ts so the unit test can import it without
 * pulling in the pi-tui transitive dep (which is not vitest-resolvable).
 */
import type { XddRunnerState, XddStageName, XddStageOutcome } from "./types.ts";

export function decideFollowUp(
	outcome: XddStageOutcome,
	stageName: XddStageName | string,
	state: XddRunnerState,
): string | null {
	const name = stageName as XddStageName;
	const remaining = state.remainingSelfHealBudget(name);
	const healMax = state.maxSelfHealPerStage;
	const healUsed = healMax - remaining;
	const err = state.lastStageError ? `\n原因：${state.lastStageError}` : "";
	switch (outcome) {
		case "idle":
		case "working":
			return `[xdd 自动推进] 继续 ${stageName} 阶段。请调 xdd_submit_artifact 提交产物（summary + artifacts + selfAttack）。`;

		case "hard_gate_failed":
			if (remaining > 0) {
				return `[xdd 自动推进] ${stageName} 闸门未通过。剩余自愈预算 ${remaining}/${healMax}（已用 ${healUsed}）。${err}请修复产物后重新调 xdd_submit_artifact。`;
			}
			return `[xdd] ${stageName} 闸门未通过且自愈预算耗尽（${healUsed}/${healMax}）。${err}请改变策略：调 xdd_diagnose 诊断根因，或 xdd_rollback 回退到设计层修复后重跑。`;

		case "ai_gate_failed":
			if (remaining > 0) {
				return `[xdd 自动推进] ${stageName} AIGate 多角度攻击未通过。剩余自愈预算 ${remaining}/${healMax}（已用 ${healUsed}）。${err}请根据反馈修复产物后重新调 xdd_submit_artifact。`;
			}
			return `[xdd] ${stageName} AIGate 未通过且自愈预算耗尽（${healUsed}/${healMax}）。${err}请调 xdd_diagnose 诊断根因，或 xdd_rollback 回退。`;

		case "gate_passed":
			return `[xdd 自动推进] ${stageName} 闸门已通过。调 xdd_advance 推进到下一阶段。`;

		case "advanced":
			return `[xdd 自动推进] 已进入 ${stageName} 阶段。请调 xdd_observe、xdd_desired_state、xdd_difference，按差距完成阶段产物。`;

		case "provider_error":
		case "paused":
		case "completed":
		case "failed":
			return null;
	}
}
