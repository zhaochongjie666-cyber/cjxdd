import { gitHasChanges, requireGlobs } from "./gate.ts";
import type { XddStageGroup, XddStageName } from "./types.ts";

/**
 * Four macro stage-groups matching the SVG pipeline. Each group has a Gate that
 * runs after the group's last stage passes, enforcing the "不可跳过" contract
 * at a coarser granularity than per-stage gates.
 */
export const STAGE_GROUPS: readonly XddStageGroup[] = [
	{
		name: "discovery",
		label: "需求研究与规格收敛",
		stages: ["init", "understand", "spec", "resilience"],
		gate: async ({ cwd }) => {
			const specOk = await requireGlobs(cwd, ["docs/spec.md", "spec.md"]);
			if (!specOk.ok) return { ok: false, reason: "Gate 1: 缺少 spec.md 产物" };
			const resOk = await requireGlobs(cwd, ["docs/resilience.md", "resilience.md"]);
			if (!resOk.ok) return { ok: false, reason: "Gate 1: 缺少 resilience.md 产物" };
			return { ok: true };
		},
		rollbackTarget: "init",
		gateLabel: "Gate 1: 规格一致、无阻断矛盾、全部可验收",
	},
	{
		name: "architecture",
		label: "架构设计",
		stages: ["architecture", "wire"],
		gate: async ({ cwd }) => {
			const archOk = await requireGlobs(cwd, ["docs/architecture.md", "architecture.md"]);
			if (!archOk.ok) return { ok: false, reason: "Gate 2: 缺少 architecture.md 产物" };
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
			const planOk = await requireGlobs(cwd, ["docs/plan.md", "plan.md"]);
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
			const specOk = await requireGlobs(cwd, ["docs/spec.md", "spec.md"]);
			if (!specOk.ok) return { ok: false, reason: "Gate 4: 缺少 spec.md，无法验证验收标准" };
			const changesOk = await gitHasChanges(cwd);
			if (!changesOk.ok) return { ok: false, reason: "Gate 4: 无代码改动可验证" };
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
