import {
	gitHasChanges,
	requireGlobs,
	requireGlobsWithKeywords,
	requireGlobsWithMinSize,
	softPass,
} from "./gate.ts";
import type { XddStageName, XddStageSpec } from "./types.ts";
import { STAGE_ROLES } from "./types.ts";

const roleFor = (name: XddStageName): string => STAGE_ROLES[name];

const CONTROLLER_TOOLS = ["xdd_submit_artifact", "xdd_list_skills", "xdd_load_skill"] as const;
const READ_TOOLS = ["read", "grep", "find", "ls"] as const;
const WRITE_TOOLS = ["write", "edit"] as const;

export const STAGES: readonly XddStageSpec[] = [
	{
		name: "init",
		role: roleFor("init"),
		skill: "xdd-init",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...CONTROLLER_TOOLS],
		desiredState: [
			"已读仓库现有文档（README / docs/ / .xdd/design/ 如存在），对项目目标有 3-5 句话的总结",
			"已与用户确认或在 prompt 中明示了本次 run 的目标边界（在 init 末尾向用户复述一遍即可）",
			"已选好本次用到的 xdd 技能子集（xdd_list_skills -> xdd_load_skill）",
		],
		deliverablePaths: [],
		gate: async () => softPass(),
	},
	{
		name: "understand",
		role: roleFor("understand"),
		skill: "xdd-brainstorm",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...CONTROLLER_TOOLS],
		desiredState: [
			"已读完前序产物（init 阶段总结、仓库 README / docs/）",
			"已向用户输出一份 '需求 clarification'：用户原始需求 + 显式/隐式假设 + 待澄清问题",
			"已梳理用户旅途（主线/分支/迂回/意外/探索 5 层次），写入 .xdd/design/notes/ 或向用户复述确认",
			"已产出意图锚（.xdd/design/design.md 5 段收敛决策：Selected/Alternatives/Assumptions/Out of Scope/Open Questions）",
			"已与用户就最关键 2-3 个模糊点达成一致，或在 prompt 中明确声明无法澄清时的合理默认",
			"已自我攻击：检查是否有遗漏的隐含假设或异常路径，并记录结论",
		],
		deliverablePaths: [".xdd/design/design.md"],
		gate: async ({ cwd }) => {
			const designOk = await requireGlobs(cwd, [".xdd/design/design.md"]);
			if (!designOk.ok) return { ok: false, reason: "understand Gate: 缺少 .xdd/design/design.md（意图锚，spec 的上游）" };
			return { ok: true };
		},
	},
	{
		name: "spec",
		role: roleFor("spec"),
		skill: "xdd-spec",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...CONTROLLER_TOOLS],
		desiredState: [
			"已产出可验收的业务规则（RXX）+ Gherkin 场景（.xdd/design/spec/{bxx}/rules.md + *.feature）",
			"每条 RXX 规则至少 1 个 Feature 覆盖（含正向 + 异常 Scenario）",
			"规则与 understand 阶段澄清的需求点逐条对应（无遗漏假设）",
			"已列已知/未知四象限（已知的已知 / 已知的未知 / 未知的已知 / 未知的未知）并标注每项处置",
			"已自我攻击：检查真实场景是否成立、遗漏异常路径与反例，并记录结论",
		],
		deliverablePaths: [".xdd/design/spec/**/rules.md", ".xdd/design/spec/**/*.feature"],
		gate: async ({ cwd }) => {
			const rulesOk = await requireGlobsWithMinSize(cwd, [".xdd/design/spec/**/rules.md"], 100);
			if (!rulesOk.ok) return { ok: false, reason: "spec Gate: 缺少或过短的 .xdd/design/spec/**/rules.md（RXX 规则目录）" };
			const featOk = await requireGlobs(cwd, [".xdd/design/spec/**/*.feature"]);
			if (!featOk.ok) return { ok: false, reason: "spec Gate: 缺少 .xdd/design/spec/**/*.feature（每条 RXX 至少 1 个场景）" };
			return { ok: true };
		},
	},
	{
		name: "architecture",
		role: roleFor("architecture"),
		skill: "xdd-architecture",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...CONTROLLER_TOOLS],
		desiredState: [
			"已产出系统架构文档（.xdd/design/architecture/{bxx}/architecture.md + 全局 module-landscape.md）",
			"包含：模块划分、模块间依赖关系、数据流向、关键技术选型及权衡理由",
			"明确每个模块对应 spec 中的哪条 RXX 规则",
			"识别至少 1 个失败模式 / 风险点（与 resilience 阶段的关注点对接）",
			"已自我攻击：检查耦合泄漏、循环依赖、隐藏单点，并记录结论",
		],
		deliverablePaths: [".xdd/design/architecture/**/architecture.md"],
		gate: async ({ cwd }) =>
			requireGlobsWithKeywords(
				cwd,
				[".xdd/design/architecture/**/architecture.md"],
				["模块", "依赖", "数据流", "失败"],
				2,
			),
	},
	{
		name: "wire",
		role: roleFor("wire"),
		skill: "xdd-wire",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, "bash", ...CONTROLLER_TOOLS],
		desiredState: [
			"已创建 spec 规则涉及的所有模块骨架（文件存在且可被 import / require）",
			"模块间接口已按 architecture 文档的依赖连起来（至少能 import 通）",
			"运行一次空实现，确认模块图能加载（避免架构性错误）",
		],
		deliverablePaths: [],
		gate: async ({ cwd }) => gitHasChanges(cwd),
	},
	{
		name: "resilience",
		role: roleFor("resilience"),
		skill: "xdd-resilience",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...CONTROLLER_TOOLS],
		desiredState: [
			"已产出失败模式目录与兜底设计（.xdd/design/architecture/{bxx}/resilience/failure-modes.md + failsafe-design.md）",
			"覆盖 architecture 中识别的失败模式：每个失败模式的检测 / 隔离 / 恢复策略",
			"记录依赖超时 / 重试 / 降级 / 资源限制等通用容错决策",
			"已产出韧性测试计划（resilience-test-plan.md），含失败模式 × 自动化/手工/巡检矩阵",
			"已自我攻击：检查是否存在单点故障、恢复语义是否含糊、模块是否真正可替换",
		],
		deliverablePaths: [
			".xdd/design/architecture/**/resilience/failure-modes.md",
			".xdd/design/architecture/**/resilience/failsafe-design.md",
			".xdd/design/architecture/**/resilience/resilience-test-plan.md",
		],
		gate: async ({ cwd }) => {
			const fmOk = await requireGlobsWithMinSize(cwd, [".xdd/design/architecture/**/resilience/failure-modes.md"], 100);
			if (!fmOk.ok) return fmOk;
			const fsOk = await requireGlobs(cwd, [".xdd/design/architecture/**/resilience/failsafe-design.md"]);
			if (!fsOk.ok) return { ok: false, reason: "resilience Gate: 缺少 failsafe-design.md（兜底设计）" };
			const tpOk = await requireGlobs(cwd, [".xdd/design/architecture/**/resilience/resilience-test-plan.md"]);
			if (!tpOk.ok) return { ok: false, reason: "resilience Gate: 缺少 resilience-test-plan.md（测试方法论）" };
			return { ok: true };
		},
	},
	{
		name: "plan",
		role: roleFor("plan"),
		skill: "xdd-plan",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...CONTROLLER_TOOLS],
		desiredState: [
			"已产出执行计划文档（.xdd/runs/iter-N/plan/{bxx}/plan.md）",
			"计划按阶段组织：spec -> architecture -> wire -> resilience -> execute 每段至少一项具体工作项",
			"每项工作项标明：依赖前序产出、预计产物、改动文件范围",
			"识别关键路径与可并行项（不强制并行，但能标注）",
		],
		deliverablePaths: [".xdd/runs/**/plan.md"],
		gate: async ({ cwd }) => requireGlobsWithMinSize(cwd, [".xdd/runs/**/plan.md"], 100),
	},
	{
		name: "execute",
		role: roleFor("execute"),
		skill: "xdd-execute",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, "bash", ...CONTROLLER_TOOLS],
		desiredState: [
			"已按 plan 工作项完成实现",
			"代码改动落在 plan 标注的文件范围内（无未授权改动）",
			"每个新模块至少含 1 个最小可运行入口（main/index/handler），可被 wire 阶段的 import 通过",
			"已自我攻击：检查越界修改、重复实现、脆弱耦合，并记录结论",
		],
		deliverablePaths: [],
		gate: async ({ cwd }) => gitHasChanges(cwd),
	},
	{
		name: "cleanup",
		role: roleFor("cleanup"),
		skill: "xdd-cleanup",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, "bash", ...CONTROLLER_TOOLS],
		desiredState: [
			"已删除所有调试代码 / 注释 / 待办标记 / 占位符",
			"已统一格式（参考 plan 约定的风格 / linter）",
			"已剔除未被引用的死代码 / 死文件",
			"已更新 README / docs 反映最终接口与使用方式",
		],
		deliverablePaths: [],
		gate: async ({ cwd }) => gitHasChanges(cwd),
	},
	{
		name: "verify",
		role: roleFor("verify"),
		skill: "xdd-verify",
		exit: "verdict",
		allowedTools: [...READ_TOOLS, "bash", ...CONTROLLER_TOOLS],
		desiredState: [
			"已对 spec 的每条 RXX 规则至少跑一次验证（手动 / 单元 / 集成 / 端到端之一）",
			"验证结果可复现（命令或脚本有据可查）",
			"未在 verify 阶段改动契约或架构（仅验证，不修改）",
			"已自我攻击：检查是否真正满足原始用户旅途、是否有未验证假设，并记录结论",
		],
		deliverablePaths: [],
		gate: async ({ cwd }) => {
			const specOk = await requireGlobs(cwd, [".xdd/design/spec/**/rules.md"]);
			if (!specOk.ok) return { ok: false, reason: "Gate 4: 缺少 spec rules.md，无法验证验收标准" };
			const changesOk = await gitHasChanges(cwd);
			if (!changesOk.ok) return { ok: false, reason: "Gate 4: 无代码改动可验证" };
			return { ok: true };
		},
	},
];
