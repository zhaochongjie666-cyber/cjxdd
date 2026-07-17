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
	const err = state.lastStageError ? `\n原因：${state.lastStageError}` : "";
	switch (outcome) {
		case "idle":
		case "working":
			return `[xdd 自动推进] 继续 ${stageName} 阶段。请调 xdd_submit_artifact 提交产物（summary + artifacts；selfAttack 整个 run 只提交一次）。`;

		case "hard_gate_failed":
			{
				const budget = state.stageSelfHealBudget(name, "hard_gate");
				if (!budget.exhausted) {
					return `[xdd 自动推进] ${stageName} 硬 Gate 未通过。剩余硬 Gate 自愈预算 ${budget.remaining}/${budget.limit}（已用 ${budget.used}）。${err}请修复产物后重新调 xdd_submit_artifact。`;
				}
				return `[xdd] ${stageName} 硬 Gate 未通过且硬 Gate 自愈预算耗尽（${budget.used}/${budget.limit}）。${err}${name === "verify" ? "verify 会自动消耗流程回退预算并回退到诊断出的缺陷阶段；请调 xdd_next_task 继续。" : "该非 verify 阶段已软通过；请调 xdd_advance 推进。"}`;
			}

		case "ai_gate_failed":
			{
				const budget = state.stageSelfHealBudget(name, "ai_gate");
				if (!budget.exhausted) {
					return `[xdd 自动推进] ${stageName} AIGate 多角度攻击未通过。剩余 AIGate 自愈预算 ${budget.remaining}/${budget.limit}（已用 ${budget.used}）。${err}请根据反馈修复产物后重新调 xdd_submit_artifact。`;
				}
				return `[xdd] ${stageName} AIGate 未通过且 AIGate 自愈预算耗尽（${budget.used}/${budget.limit}）。${err}${name === "verify" ? "verify 会自动消耗流程回退预算并回退到诊断出的缺陷阶段；请调 xdd_next_task 继续。" : "该非 verify 阶段已软通过；请调 xdd_advance 推进。"}`;
			}

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
