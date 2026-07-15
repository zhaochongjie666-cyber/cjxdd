import {
	gitHasChanges,
	requireBlindJourneyReports,
	requireGlobs,
	requireGlobsWithKeywords,
	requireGlobsWithMinSize,
	requirePatternInSource,
	requirePersonas,
	requireTestsPass,
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
			"已自我攻击：检查是否遗漏了仓库现有约束/技术债/目标边界模糊，并记录结论",
		],
		deliverablePaths: [],
		noCodeReading: true,
		aigateStandard: `审查 init 阶段：
1. .xdd/ 目录结构是否完整（runs/ design/ archive/）
2. 是否有占位符或空壳（不能只有目录没有 README/说明）
3. goals.md 占位是否合理（待 brainstorm 替换）`,
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
			"已做用户角色模拟：按 7 类（主用户/管理用户/间接用户/外部系统/审计合规/开发运维/边缘角色）自主发散布全角色，每角色产出深度档案（10 维度），写入 .xdd/design/personas/",
			"已产出意图锚对（.xdd/design/intent.md 定位+成功标准+非目标 + .xdd/design/design.md 5 段收敛决策：Selected/Alternatives/Assumptions/Out of Scope/Open Questions）",
			"已产出本 iter 高层目标（.xdd/runs/iter-N/goals.md，分配 G 编号供 plan 回指）",
			"已与用户就最关键 2-3 个模糊点达成一致，或在 prompt 中明确声明无法澄清时的合理默认",
			"已自我攻击：检查是否有遗漏的隐含假设或异常路径，并记录结论",
		],
		deliverablePaths: [".xdd/design/design.md", ".xdd/design/intent.md", ".xdd/runs/*/goals.md", ".xdd/design/personas/_index.md"],
		noCodeReading: true,
		aigateStandard: `审查 understand 阶段（最严格）：
1. intent.md 的"1句话定位"是否有实质业务语义（不是"做一个系统"这种废话）
2. intent.md 的"成功标准"是否可验证（有具体数字/事实，不是"好用了""流畅了"）
3. design.md 5段是否每段有实质内容：
   - Selected: 选了什么方案，1-3句话（不是"待定"）
   - Alternatives: 至少1个被否方案 + 否定理由（不是"无"）
   - Assumptions: 具体假设（如"用PostgreSQL"），不是空
   - Out of Scope: 至少1项 + 为什么不做
   - Open Questions: 真关键决策（不是"无"敷衍）
4. personas/ 每个角色档案10维度是否都有实质内容：
   - 画像：有具体特征（年龄/技能/场景），不是"普通用户"
   - 工作流：有时间轴和具体步骤，不是"使用系统"
   - 痛点：有具体浪费/困难，不是"无"
   - 产出：有具体交付物名称，不是"结果"
   - 其他维度不能是模板化的一句话
5. personas/_index.md 的7类发散是否逐一考量（不能只写"已考量无"敷衍，要说明为什么无）
6. goals.md 的G编号是否有实质目标（不是"完成功能"这种废话）`,
				gate: async ({ cwd }) => {
			const intentOk = await requireGlobs(cwd, [".xdd/design/intent.md"]);
			if (!intentOk.ok) return { ok: false, reason: "understand Gate: 缺少 .xdd/design/intent.md（定位+成功标准+非目标）" };
			const designOk = await requireGlobsWithKeywords(cwd, [".xdd/design/design.md"], ["Selected", "Alternatives", "Assumptions", "Out of Scope", "Open Questions"], 4);
			if (!designOk.ok) return { ok: false, reason: "understand Gate: .xdd/design/design.md 缺少收敛决策 5 段（Selected/Alternatives/Assumptions/Out of Scope/Open Questions，至少 3 段）" };
			const goalsOk = await requireGlobs(cwd, [".xdd/runs/*/goals.md"]);
			if (!goalsOk.ok) return { ok: false, reason: "understand Gate: 缺少 .xdd/runs/*/goals.md（G 编号，plan 的上游）" };
			const personasOk = await requirePersonas(cwd);
			if (!personasOk.ok) return personasOk;
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
			noCodeReading: true,
		aigateStandard: `审查 spec 阶段（最严格，可开发性审查）：
1. 是否先提取了业务事实再写 Gherkin（角色/对象/状态/前置/成功结果/失败结果/副作用）-- 直接写 Gherkin = 不通过
2. 是否建立了场景覆盖矩阵，八类逐类判断（主路径/权限/状态转换/边界/幂等/并发/外部失败/审计）-- 只有主路径 = 不通过
3. 是否规则优先（先写 Rule 再写 Scenario）-- UI 操作脚本 = 不通过
4. Scenario 是否用具体角色/对象ID/状态/数字 -- "用户""相关权限""超过限制" = 不通过
5. Then 是否写外部可观察结果（状态变化/负责人/审计/通知）-- "操作成功""系统正确处理" = 不通过
6. 失败场景是否写了"原状态不变""不产生副作用" -- 没写 = 不通过
7. 并发场景是否写了"只能一次成功""失败方收到提示" -- 没写 = 不通过
8. 是否有假装精确（未经确认的时间/数量/错误码，没标@待确认）= 不通过
9. 是否有实现细节冒充业务规则（数据库字段/assignee_id）= 不通过
10. 每条 RXX 是否关联角色 PX 且跟 personas 一致 -- 没角色 = 不通过
11. When/Then 是否含实现细节词（调度器/线程池/锁/CAS/重试）= 不通过
12. 可开发性五问：开发能否看出规则？测试能否构造数据？产品能否判断验收？失败后不变化的数据写清了？删了步骤代码还是完整业务规范？`,
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
		deliverablePaths: [
			".xdd/design/architecture/**/architecture.md",
			".xdd/design/architecture/module-landscape.md",
			".xdd/design/architecture/event-contract.md",
			".xdd/design/architecture/aggregate-landscape.md",
		],
			noCodeReading: true,
		aigateStandard: `审查 architecture 阶段（可开发性 + 可追踪性 + 去AI味）：
1. 是否从 Feature 提取了架构含义（Feature->架构映射链），不是直接生成 Controller/Service/Repository -- 不通过
2. 是否提取了业务规则 BR-XX，每条能追溯到 RXX 和 AC-XX -- 没提取 -> 不通过
3. 三类信息是否分开（已知事实/架构决策/待确认问题）-- 待确认伪装成确定规则 -> 不通过
4. 是否有当前系统约束（单体/微服务、是否有MQ、数据量）-- 缺失 -> 不通过
5. 是否有非目标（明确不做什么，控制范围）-- 没写 -> 不通过
6. 领域模型是否有核心实体+字段+关系（不是贫血模型只有getter/setter）-- 不通过
7. 状态机是否跟 spec 的 Scenario Outline 一致（哪些状态允许/禁止操作）-- 不一致 -> 不通过
8. 模块职责表是否写了"不负责"列 -- 只有类名清单 -> 不通过
9. 核心执行流程是否有编号步骤（不只是时序图）-- 没写 -> 不通过
10. 事务边界是否明确（什么在事务内/外，通知失败不回滚主业务）-- 没写 -> 不通过
11. 并发控制是否写了具体方案+SQL+理由 -- 只写"系统需要防止并发" -> 不通过
12. 失败模式表是否结构化（失败点->主业务结果->处理），不是散文 -- 散文 -> 不通过
13. 数据设计是否有索引/约束/生命周期（审计记录append-only）-- 没写 -> 不通过
14. Feature追踪矩阵是否完整（场景->BR->用例->模块->数据->测试）-- 没写 -> 不通过
15. 可观测性是否定义了日志/指标/告警，告警阈值标"待确认"或基于生产数据 -- 只写"系统应记录" -> 不通过
16. ADR 是否写了关键决策的背景/选择/原因/放弃方案 -- 没写 -> 不通过
17. API错误码是否来自业务规则且稳定（不是随意发明）-- 随意发明 -> 不通过
18. 质量属性有具体响应度量，性能取舍有具体理由 -- "高性能高可用高扩展" -> 不通过
19. 背景写了真实问题（不是"随着业务不断发展"）-- AI味开头 -> 不通过
20. module-landscape.md 有真实模块依赖关系，event-contract.md 事件有具体字段`,
				gate: async ({ cwd }) => {
			const archOk = await requireGlobsWithKeywords(
				cwd,
				[".xdd/design/architecture/**/architecture.md"],
				["模块", "依赖", "数据流", "失败"],
				3,
			);
			if (!archOk.ok) return { ok: false, reason: "architecture Gate: architecture.md 缺少关键章节（模块/依赖/数据流/失败，至少 3 项）" };
			const modOk = await requireGlobs(cwd, [".xdd/design/architecture/module-landscape.md"]);
			if (!modOk.ok) return { ok: false, reason: "architecture Gate: 缺少 module-landscape.md（模块全景，plan 的上游）" };
			const eventOk = await requireGlobs(cwd, [".xdd/design/architecture/event-contract.md"]);
			if (!eventOk.ok) return { ok: false, reason: "architecture Gate: 缺少 event-contract.md（事件契约，plan/resilience 的上游）" };
			const aggOk = await requireGlobs(cwd, [".xdd/design/architecture/aggregate-landscape.md"]);
			if (!aggOk.ok) return { ok: false, reason: "architecture Gate: 缺少 aggregate-landscape.md（聚合全景，plan/verify 的上游）" };
			return { ok: true };
		},
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
			"已自我攻击：检查模块图是否有循环依赖、接口是否真能 import 通、是否漏了 spec 规则涉及的模块，并记录结论",
		],
		deliverablePaths: [".xdd/design/wire/*.md"],
		noCodeReading: true,
		aigateStandard: `审查 wire 阶段：
1. 每个页面一个 .md 文件（不是一堆 HTML）
2. 每页有嵌入式 HTML 布局（desktop + mobile），不是空壳
3. 元素清单标了 @covers-RXX（每个元素有来源规则）
4. 6 操作态全覆盖（空/加载/错误/成功/确认/边界），每态有嵌入式 HTML + 说明
5. 每态的内容不是模板敷衍（空状态有行动引导，错误态有人话+重试，确认态有后果说明）
6. 每页底部有 Review（Q1-Q5 逐条回答，不是"无问题"敷衍）
7. 页面清单跟 spec 的 RXX 对应（不能漏页面、不能多页面）
8. 混淆元素 A/B/C/D 四类有扫描记录`,
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
			noCodeReading: true,
		aigateStandard: `审查 resilience 阶段：
1. failure-modes.md 的每个失败模式是否有具体场景（不是"网络错误"敷衍）
2. failsafe.md 的兜底策略是否可操作（有具体动作，不是"降级处理"）
3. test-plan.md 的测试是否有具体步骤（不是"测试失败场景"）
4. 失败模式是否覆盖了architecture的失败模型（不能漏）
5. 每个失败模式是否关联了RXX规则`,
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
			"已自我攻击：检查是否有遗漏的依赖、被标并行却实际串行的项、task 粒度过大或过小，并记录结论",
		],
		deliverablePaths: [".xdd/runs/**/plan.md"],
		aigateStandard: `审查 plan 阶段：
1. plan.md 的每个task是否有具体描述（不是"实现R01"敷衍，要有步骤）
2. task是否覆盖了所有RXX规则（不能漏RXX）
3. task粒度是否合理（不能一个task覆盖10个RXX，也不能太碎）
4. task是否有优先级/依赖关系（不是无序列表）
5. 每个task是否关联了G编号（goal回指）`,
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
		aigateStandard: `审查 execute 阶段（最严格）：
1. 代码是否有 @implements RXX 标注（每条RXX都有对应实现）
2. @implements RXX 的代码是否真的实现了RXX规则（不是假标注）
3. 测试是否覆盖了异常路径（不能只测happy path）
4. 测试断言是否有具体值（不能是 expect(true).toBe(true) 这种 trivial）
5. 代码是否跟spec的BDD场景对应（When/Then有代码实现）
6. 有无TODO/占位/FIXME未完成（不通过）
7. 代码是否跟architecture的模块划分一致`,
				gate: async ({ cwd }) => {
			const r = await requirePatternInSource(cwd, /@implements\s+R\d/i, 1);
			if (!r.ok) return { ok: false, reason: "execute Gate: 源码中未见 @implements RXX 标注（每条 RXX 实现须回指规则编号，衔接 spec→code→verify 追溯链）" };
			return { ok: true };
		},
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
			"已自我攻击：检查是否误删了 @implements RXX 追溯锚、是否越界改了无关文件、是否留了模糊 TODO，并记录结论",
		],
		deliverablePaths: [],
		aigateStandard: `审查 cleanup 阶段：
1. 是否有调试代码残留（console.log/print/debugger -> 不通过）
2. 是否有未使用的import/依赖（-> 不通过）
3. 是否有死代码（注释掉的大段代码 -> 不通过）
4. 代码格式是否一致（import顺序/命名风格）`,
				gate: async () => softPass(),
	},
	{
		name: "verify",
		role: roleFor("verify"),
		skill: "xdd-verify",
		exit: "verdict",
		allowedTools: [...READ_TOOLS, "bash", ...CONTROLLER_TOOLS, "xdd_blind_journey"],
		desiredState: [
			"已对 spec 的每条 RXX 规则至少跑一次验证（手动 / 单元 / 集成 / 端到端之一）",
			"验证结果可复现（命令或脚本有据可查）",
			"未在 verify 阶段改动契约或架构（仅验证，不修改）",
			"已自我攻击：检查是否真正满足原始用户旅途、是否有未验证假设，并记录结论",
			"已执行盲测用户验收（Blind Journey）：定义角色、用 xdd_blind_journey 工具执行 Actor/Judge 两阶段、记录结果、生成覆盖报告（纯后端项目跳过）",
		],
		deliverablePaths: [".xdd/runs/*/verify-report.md"],
		aigateStandard: `审查 verify 阶段（最严格，全链路不断裂）：
1. verify-report.md 是否逐条验证了RXX规则（不能只写"全部通过"）
2. 每条验证是否有具体证据（测试名/测试结果/代码位置，不是"已测试"敷衍）
3. 测试是否真的跑了（不能是trivial测试骗通过）
4. 异常路径测试是否覆盖（不能只测正常流程）
5. 有无未通过的测试被忽略/跳过（-> 不通过）
6. verify-report是否跟intent.md的成功标准对应（不能漏验收标准）
7. 追踪矩阵是否完整：每个AC-XX有架构+代码+测试，每个BR有测试，无幽灵代码 -- 断裂 -> 不通过
8. 四层测试是否覆盖：领域/应用服务/Repository集成/Feature验收 -- 缺层 -> 不通过
9. Feature验收测试是否通过公开API调用（不绕过应用层直接改DB）-- 绕过 -> 不通过
10. 代码级质量：领域规则不住Controller？DB负责并发（条件更新不是先查后改）？审计append-only？通知不破坏主事务？身份来自认证上下文？-- 任一不达标 -> 不通过
11. Blind Journey（如已定义角色）：Actor 是否真按用户视角操作（不查看代码/DOM/API）？Judge 是否有完整 Feature + 证据对照？每个 Then 是否有可见证据？PASS_WITH_FRICTION 是否列了具体体验问题？BLOCKED/INCONCLUSIVE 是否给了具体原因？覆盖报告是否列了所有角色？`,
				gate: async ({ cwd }) => {
			const specOk = await requireGlobs(cwd, [".xdd/design/spec/**/rules.md"]);
			if (!specOk.ok) return { ok: false, reason: "verify Gate: 缺少 spec rules.md，无法验证验收标准" };
			const reportOk = await requireGlobsWithMinSize(cwd, [".xdd/runs/*/verify-report.md"], 100);
			if (!reportOk.ok) return { ok: false, reason: "verify Gate: 缺少验证报告 .xdd/runs/iter-N/verify-report.md（含健康检查+漫游+全链路审计+双契约）" };
			const testsOk = await requireTestsPass(cwd);
			if (!testsOk.ok) return testsOk;
			const bjOk = await requireBlindJourneyReports(cwd);
			if (!bjOk.ok) return bjOk;
			return { ok: true };
		},
	},
];
