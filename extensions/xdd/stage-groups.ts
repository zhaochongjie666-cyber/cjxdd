import { gitHasChanges, requireGlobs, requireGlobsWithMinSize } from "./gate.ts";
import type { XddStageGroup, XddStageName } from "./types.ts";

/**
 * Four macro stage-groups matching the xdd pipeline. Each group has a Gate that
 * runs after the group's last stage passes, enforcing the "不可跳过" contract
 * at a coarser granularity than per-stage gates.
 *
 * Group boundaries are contiguous with STAGES execution order:
 *   discovery(0-2) -> architecture(3-5) -> implementation(6-8) -> verification(9)
 *
 * resilience lives in the architecture group (not discovery) because the
 * xdd-resilience skill depends on architecture -- "韧性是架构的延伸：失败模式
 * 建立在 architecture 的战术之上" (xdd-resilience/SKILL.md). core.md 阶段一.6
 * 的 "Feature 级可靠性" 由 spec 阶段的已知/未知四象限 desiredState 兜底；深度
 * FMEA + 韧性测试计划在 architecture 组（post-architecture）做。这让组边界与
 * 执行顺序连续，Gate 1（discovery 出口）不再晚于 Gate 2（architecture 出口）。
 */
export const STAGE_GROUPS: readonly XddStageGroup[] = [
	{
		name: "discovery",
		label: "需求研究与规格收敛",
		stages: ["init", "understand", "spec"],
		gate: async ({ cwd }) => {
			const designOk = await requireGlobs(cwd, [".xdd/design/design.md"]);
			if (!designOk.ok) return { ok: false, reason: "Gate 1: 缺少 .xdd/design/design.md（意图锚）" };
			const rulesOk = await requireGlobs(cwd, [".xdd/design/spec/**/rules.md"]);
			if (!rulesOk.ok) return { ok: false, reason: "Gate 1: 缺少 .xdd/design/spec/**/rules.md 产物" };
			const featOk = await requireGlobs(cwd, [".xdd/design/spec/**/*.feature"]);
			if (!featOk.ok) return { ok: false, reason: "Gate 1: 缺少 .xdd/design/spec/**/*.feature 产物" };
			return { ok: true };
		},
		rollbackTarget: "init",
		gateLabel: "Gate 1: 规格一致、无阻断矛盾、全部可验收",
	},
	{
		name: "architecture",
		label: "架构设计",
		stages: ["architecture", "wire", "resilience"],
		gate: async ({ cwd }) => {
			const archOk = await requireGlobs(cwd, [".xdd/design/architecture/**/architecture.md"]);
			if (!archOk.ok) return { ok: false, reason: "Gate 2: 缺少 architecture.md 产物" };
			const resOk = await requireGlobs(cwd, [".xdd/design/architecture/**/resilience/failure-modes.md"]);
			if (!resOk.ok) return { ok: false, reason: "Gate 2: 缺少 resilience/failure-modes.md 产物" };
			const changesOk = await gitHasChanges(cwd);
			if (!changesOk.ok) return { ok: false, reason: "Gate 2: wire 阶段无代码骨架改动" };
			return { ok: true };
		},
		rollbackTarget: "architecture",
		gateLabel: "Gate 2: 模块独立可测试",
	},
	{
		name: "implementation",
		label: "代码实现",
		stages: ["plan", "execute", "cleanup"],
		gate: async ({ cwd }) => {
			const planOk = await requireGlobs(cwd, [".xdd/runs/**/plan.md"]);
			if (!planOk.ok) return { ok: false, reason: "Gate 3: 缺少 plan.md 产物" };
			const changesOk = await gitHasChanges(cwd);
			if (!changesOk.ok) return { ok: false, reason: "Gate 3: 无实现代码改动" };
			return { ok: true };
		},
		rollbackTarget: "plan",
		gateLabel: "Gate 3: 构建与单测全部通过",
	},
	{
		name: "verification",
		label: "验证交付",
		stages: ["verify"],
		gate: async ({ cwd }) => {
			const specOk = await requireGlobs(cwd, [".xdd/design/spec/**/rules.md"]);
			if (!specOk.ok) return { ok: false, reason: "Gate 4: 缺少 spec rules.md，无法验证验收标准" };
			const reportOk = await requireGlobsWithMinSize(cwd, [".xdd/runs/*/verify-report.md"], 100);
			if (!reportOk.ok) return { ok: false, reason: "Gate 4: 缺少验证报告 verify-report.md（健康检查+漫游+全链路审计+双契约）" };
			return { ok: true };
		},
		rollbackTarget: "verify",
		gateLabel: "Gate 4: 全部验收标准达成",
	},
];

export function findStageGroup(stageName: XddStageName): XddStageGroup | undefined {
	return STAGE_GROUPS.find((g) => g.stages.includes(stageName));
}

export function isLastStageInGroup(stageName: XddStageName): boolean {
	const group = findStageGroup(stageName);
	if (!group) return false;
	return group.stages[group.stages.length - 1] === stageName;
}
