/**
 * AIGate: 统一审查层。机械检查结果是它的一个输入，由同一个 LLM
 * 以"多角度攻击者"角色连同产物语义一起审查，抓机械检查抓不到的偷工减料、设计缺陷、
 * 安全漏洞、一致性断裂、遗漏场景。
 *
 * 设计原则：
 *   - 每个阶段都跑
 *   - 用同一个模型（pi 当前 model）
 *   - 多角度攻击（偷工减料 + AI味 + 规格偏离 + 阶段特定攻击角度）
 *   - 机械检查不单独放行/拦截；最终 verdict 只由 AIGate 给出
 *   - 不通过 -> 自愈预算耗尽后回退（复用现有机制）
 *   - 死审查标准（每阶段写死在 stages.ts 的 aigateStandard）
 *   - 跨产物上下文（读 spec/architecture/code 做一致性攻击）
 *
 * Phase 6 (D): failure semantics flipped. Previously soft-passed on
 * any error (LLM/JSON/parse); now HARD-FAIL so the agent can see and
 * fix the issue instead of the gate silently saying "PASS". Only the
 * gate's *content* failure (LLM says "this angle found bugs") blocks;
 * errors (network/parse) are reported as `degraded` with `passed: false`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { complete, type AssistantMessage, type Model } from "@earendil-works/pi-ai/compat";
import { resolveGlobs, safeRealpath } from "./glob-resolver.ts";
import type { XddGateResult } from "./types.ts";
import { CODE_REVIEW_ANGLES } from "./code-review.ts";
import { COMMIT_REVIEW_ANGLES } from "./commit-review.ts";

/**
 * AIGate reviews several artifacts and returns one verdict per attack angle.
 * A ten-minute window accommodates slower compatible providers when
 * architecture submissions also include cross-stage context.
 */
const MIN_LLM_TIMEOUT_MS = 15_000;
const MAX_LLM_TIMEOUT_MS = 600_000;
const DEFAULT_LLM_TIMEOUT_MS = configuredTimeoutMs();

function configuredTimeoutMs(): number {
	const value = Number.parseInt(process.env.XDD_AIGATE_TIMEOUT_MS ?? "", 10);
	if (!Number.isFinite(value)) return 600_000;
	return Math.min(MAX_LLM_TIMEOUT_MS, Math.max(MIN_LLM_TIMEOUT_MS, value));
}


// ── Types ───────────────────────────────────────────────────────────────

export interface AIGateInput {
	model: Model<any>;
	apiKey?: string;
	headers?: Record<string, string>;
	env?: Record<string, string>;
	stageName: string;
	skillName?: string;
	aigateStandard: string;
	artifactPaths: string[];
	outputContract?: readonly { pattern: string; description: string }[];
	/**
	 * The observed mechanical check result for this exact submission. It is one
	 * required dimension of the unified AIGate verdict.
	 */
	mechanicalCheckResult: XddGateResult;
	cwd: string;
	intentAnchor?: string;
	contextPatterns?: readonly string[];
	submissionSummary?: string;
}

export type XddAIGateAngleStatus = boolean | "N/A";

export interface AIGateAngleResult {
	name: string;
	passed: XddAIGateAngleStatus;
	findings: string[];
}

export interface AIGateResult {
	passed: boolean;
	angles: AIGateAngleResult[];
	issues: string[];
	suggestions: string[];
	raw?: string;
	/** The LLM call or response format failed, so this is not an artifact verdict. */
	degraded?: boolean;
}

// ── Attack angle definitions ────────────────────────────────────────────

interface AttackAngle {
	name: string;
	description: string;
	checks: string[];
}

/** Common angles applied to every stage. */
const COMMON_ANGLES: AttackAngle[] = [
	{
		name: "偷工减料攻击",
		description: "抓占位符、空壳、trivial 内容、假标注、模板敷衍",
		checks: [
			"有没有 TODO/待定/暂无/placeholder/示例文本占位符？",
			"有没有有标题无内容、有结构无细节的空壳？",
			"测试是否只测 happy path、断言无具体值？",
			"@implements RXX 标注是否跟 RXX 规则真的相关（假标注）？",
			"规则/决策是否有业务语义，还是空泛废话？",
		],
	},
	{
		name: "AI味攻击",
		description: "抓 AI 生成痕迹：套话、营销词、机械列举、无立场",
		checks: [
			"开头是否有'随着...不断发展''在当今...背景下'等 AI 味开头？",
			"是否有'首先/其次/再次/最后'机械列举？",
			"是否有'高效/智能/全面/赋能/闭环/生态/深度融合'等营销词？",
			"是否有'各有优缺点，应根据实际情况选择'这种没立场的表述？",
			"是否每段结构过于整齐（长度/句式一模一样）？",
			"是否有正确但没信息量的常识（删了不影响理解）？",
		],
	},
	{
		name: "规格偏离攻击",
		description: "产物是否偏离 intent.md 的意图和成功标准",
		checks: [
			"产物是否与 intent.md 的定位一致？",
			"产物是否覆盖了 intent.md 的成功标准？",
			"是否做了 intent.md 明确列为非目标的事情？",
		],
	},
];

/**
 * The mechanical check is an AIGate dimension, not a separate gate. The
 * expected verdict is injected from the observed check so the model cannot
 * ignore a missing artifact or a failed test while judging semantics.
 */
function mechanicalCheckAngle(result: XddGateResult): AttackAngle {
	const observation = formatMechanicalCheckResult(result);
	return {
		name: "机械检查结果",
		description: "将本次机械检查观测纳入统一 AIGate verdict，不能标记为 N/A。",
		checks: [
			`本次机械检查结果：\n${observation}`,
			result.ok
				? "机械检查已通过；确认产物内容没有利用机械检查的盲区。"
				: "机械检查未通过；此角度必须 passed=false，并在 findings 中说明失败原因。",
		],
	};
}

/** Design-layer angle: design/ is persistent, must not reference a concrete run directory. */
const ITER_POLLUTION_ANGLE: AttackAngle = {
	name: "run污染攻击",
	description: "design/ 是持久锚，不引用具体 run 目录",
	checks: [
		"design/ 下的产物是否引用了具体 run 目录？（如 .xdd/runs/xdd_run/goals.md 路径出现在 design.md/rules.md/architecture.md/wire/*.md 中）",
		"产物是否用 run 名限定持久设计？（如 '本 run 的架构' 应该是 '架构'，不绑定 run）",
		"design/ 下的文件路径是否指向 runs/xdd_run/？（design 层不该关心具体 run 目录）",
	],
};

/** Stage-specific attack angles. */
const STAGE_ANGLES: Record<string, AttackAngle[]> = {
	understand: [
		{
			name: "假设攻击",
			description: "抓未经验证的隐含假设",
			checks: [
				"有没有未经用户确认就假设的需求或约束？",
				"假设是否有依据（用户说了什么/仓库有什么），还是凭空猜测？",
				"关键模糊点是否标记为待澄清，还是直接当做确定了？",
			],
		},
		{
			name: "遗漏攻击",
			description: "抓角色/场景/需求遗漏",
			checks: [
				"7 类角色（主用户/管理用户/间接用户/外部系统/审计合规/开发运维/边缘）是否逐一考量？",
				"用户旅途 5 层次（主线/分支/迂回/意外/探索）是否覆盖？",
				"是否有明显的用户群体被遗漏？",
			],
		},
		ITER_POLLUTION_ANGLE,
	],
	spec: [
		{
			name: "遗漏攻击",
			description: "抓场景类型遗漏（8 类覆盖矩阵）",
			checks: [
				"8 类场景是否逐一判断：主路径/权限/状态转换/边界/幂等/并发/外部失败/审计？",
				"失败场景是否写了'原状态不变''不产生副作用'？",
				"并发场景是否写了'只能一次成功''失败方收到提示'？",
				"是否有 Feature 没绑定角色 PX？",
			],
		},
		{
			name: "边界攻击",
			description: "抓边界条件缺失",
			checks: [
				"数值边界（0/1/最大值/负数）是否有场景覆盖？",
				"空输入/超长输入/特殊字符是否有场景？",
				"Then 是否写外部可观察结果，而不是'操作成功'这种模糊表述？",
			],
		},
		{
			name: "可追溯性攻击",
			description: "抓规则与角色的追溯断裂",
			checks: [
				"每条 RXX 是否关联角色 PX？",
				"角色 PX 是否跟 personas/ 一致？",
				"规则是否有实现细节冒充业务规则（数据库字段/assignee_id）？",
			],
		},
		ITER_POLLUTION_ANGLE,
	],
	architecture: [
		{
			name: "安全攻击",
			description: "抓安全设计漏洞",
			checks: [
				"认证/授权方案是否完整？有没有硬编码 current_user？",
				"输入校验在哪层做？SQL 注入/XSS 防护？",
				"敏感数据是否在日志/响应中暴露？",
				"跨租户/跨项目数据隔离方案？",
			],
		},
		{
			name: "一致性攻击",
			description: "抓架构与 spec 规则的断裂",
			checks: [
				"spec 的每条 RXX 是否在架构中有对应模块/端点？",
				"端点清单是否覆盖了 spec 的所有 When 操作？",
				"状态机是否跟 spec 的 Scenario Outline 一致？",
				"事务边界是否明确（什么在事务内/外）？",
			],
		},
		{
			name: "可运维攻击",
			description: "抓部署/监控/排障缺失",
			checks: [
				"docker-compose 是否真能起来？每个服务有 healthcheck？",
				"日志/指标/告警是否定义了具体内容（不是'系统应记录'）？",
				"启动/关闭序列是否明确？状态机是否完整？",
				"有没有手工步骤没脚本化？",
			],
		},
		{
			name: "方案合理性攻击",
			description: "抓过度设计/选型不当（来自 polish 的架构批判）",
			checks: [
				"轻量项目是否上了 Kafka/微服务/etc（过度设计）？",
				"核心决策是否列了 2+ 替代方案并说明为何不选？",
				"事件驱动是否必要？同步会不会更简单？",
				"模块职责表是否写了'不负责'列（防职责泄漏）？",
			],
		},
		ITER_POLLUTION_ANGLE,
	],
	wire: [
		{
			name: "可用性攻击",
			description: "抓 6 操作态缺失和混淆元素",
			checks: [
				"6 操作态（空/加载/错误/成功/确认/边界）是否全覆盖？",
				"空状态是否有行动引导（不是空白页）？",
				"错误态是否有人话 + 重试指引（不是裸错误码）？",
				"混淆元素四类（视觉/语义/交互/内容）是否扫描？",
				"每个元素是否标了 @covers-RXX（有存在意义）？",
			],
		},
		{
			name: "遗漏攻击",
			description: "抓页面/状态遗漏",
			checks: [
				"spec 的每条 RXX 是否都有对应页面？",
				"页面清单跟 spec 规则是否一一对应（不多不少）？",
				"跨页面流程连贯性：用户从 A 页到 B 页上下文接得住吗？",
			],
		},
		ITER_POLLUTION_ANGLE,
	],
	resilience: [
		{
			name: "遗漏攻击",
			description: "抓失败模式遗漏",
			checks: [
				"8 维度失败模式是否覆盖：网络/磁盘/CPU/内存/依赖/数据/并发/安全？",
				"architecture 识别的失败模式是否都有兜底策略？",
				"是否有单点故障没识别？",
			],
		},
		{
			name: "极端攻击",
			description: "抓极端条件/混沌场景缺失",
			checks: [
				"兜底策略是否可操作（有具体动作，不是'降级处理'）？",
				"混沌场景是否有具体注入命令（iptables/docker pause/kill）？",
				"恢复剧本是否写了具体步骤（不是'重启恢复'敷衍）？",
			],
		},
	],
	plan: [
		{
			name: "粒度攻击",
			description: "抓 task 粒度不当",
			checks: [
				"是否有 task 覆盖 10+ RXX（粒度过大）？",
				"是否有 task 粒度过碎（1 行描述）？",
				"task 是否有具体步骤（不是'实现 R01'敷衍）？",
			],
		},
		{
			name: "依赖攻击",
			description: "抓依赖断裂和遗漏",
			checks: [
				"task 是否覆盖了所有 RXX 规则（不能漏 RXX）？",
				"被标并行的 task 是否真的无依赖？",
				"task 是否关联了 G 编号（goal 回指）？",
			],
		},
	],
	execute: [
		{
			name: "假实现攻击",
			description: "抓存根/假实现/sham 交付",
			checks: [
				"代码是否有 TODO/FIXME/占位符/return null 敷衍？",
				"函数是否返回硬编码值而不是真实逻辑？",
				"@implements RXX 的代码是否真的实现了 RXX 规则？",
				"有没有只写了接口没写实现？",
			],
		},
		{
			name: "测试覆盖攻击",
			description: "抓测试不足（来自 verify 的四层测试）",
			checks: [
				"异常路径测试是否覆盖（不能只测正常流程）？",
				"断言是否有具体值（不是 expect(true).toBe(true)）？",
				"并发/幂等/权限测试是否有？",
				"测试是否通过公开 API 调用（不绕过应用层直接改 DB）？",
			],
		},
		...CODE_REVIEW_ANGLES.map((name) => ({
			name,
			description: `只读 Code Reviewer：${name}`,
			checks: name === "空值安全攻击" ? ["可空值、缺失字段、空集合、错误类型收窄是否安全？"]
				: name === "并发安全攻击" ? ["共享状态、竞态、幂等、事务隔离和条件更新是否正确？"]
				: name === "资源生命周期攻击" ? ["文件、连接、流、锁、定时器和订阅是否在成功/失败路径都释放？"]
				: name === "授权与注入攻击" ? ["身份是否来自可信上下文？是否存在越权、SQL/命令/模板注入或敏感数据泄漏？"]
				: name === "错误处理攻击" ? ["异常是否被吞掉、误分类或泄露内部细节？失败是否保留原状态并可恢复？"]
				: ["生产代码是否越过 architecture 模块边界、事务边界或引入未声明依赖？"],
		})),
	],
	cleanup: [
		{
			name: "死代码攻击",
			description: "抓死代码/死文件",
			checks: [
				"是否有注释掉的大段代码？",
				"是否有未被引用的 import/依赖/文件？",
				"是否有被 @implements RXX 标注但实际已删除的代码（追溯锚断裂）？",
			],
		},
		{
			name: "残留攻击",
			description: "抓调试残留/格式不一致",
			checks: [
				"是否有 console.log/print/debugger 残留？",
				"代码格式是否一致（import 顺序/命名风格）？",
				"是否误删了 @implements RXX 追溯锚？",
			],
		},
		{
			name: "沉淀攻击",
			description: "run 结束时，验证过的“感悟”是否提升到 design/，pilot 的留在 runs/",
			checks: [
				"本 run 验证中发现的新规则/约束是否提升到 design/spec/rules.md？",
				"架构中发现的新模式/反模式是否提升到 design/architecture/？",
				"失败模式/兜底策略是否提升到 design/architecture/*/resilience/？",
				"PoC/实验结果/临时方案是否留在 runs/xdd_run/（未提升到 design/）？",
				"design/ 产物是否仍不引用具体 run 目录（提升的内容是长期结论，不绑定 run）？",
			],
		},
	],
	verify: [
		{
			name: "假完成攻击",
			description: "抓'基本完成''应该可以'等假完成表述",
			checks: [
				"验证报告是否逐条验证了 RXX（不是'全部通过'敷衍）？",
				"每条验证是否有具体证据（测试名/结果/代码位置）？",
				"有无未通过的测试被忽略/跳过？",
				"是否用了'理论上应该成功'推断 PASS？",
			],
		},
		{
			name: "证据攻击",
			description: "抓证据不足/偷懒归因",
			checks: [
				"失败归因是否有证据链（curl 输出/docker logs/端口探测）？",
				"截图/快照是否真实存在且被报告引用？",
				"漫游测试是否每步有运行证据（非'测试通过'）？",
			],
		},
		{
			name: "一致性攻击",
			description: "抓全链路追溯断裂",
			checks: [
				"追踪矩阵是否完整：每个 AC-XX 有架构+代码+测试？",
				"四层测试是否覆盖：领域/应用服务/Repository集成/Feature验收？",
				"代码级质量：领域规则不住 Controller？DB 负责并发？审计 append-only？",
				"Blind Journey（如有）：Actor 是否真按用户视角？Judge 每条 Then 有证据？",
			],
		},
	],
	commit: COMMIT_REVIEW_ANGLES.map((name) => ({
		name,
		description: `只读 staged diff reviewer：${name}`,
		checks: name === "权限校验删除攻击" ? ["diff 是否删除、绕过或弱化认证、授权、租户隔离、审计检查？"]
			: name === "测试弱化攻击" ? ["diff 是否删除测试、skip 测试、放宽断言或只改快照以掩盖行为变化？"]
			: name === "密钥泄漏攻击" ? ["diff 是否加入密钥、Token、密码、私钥、内部凭证或敏感配置？"]
			: name === "破坏性迁移攻击" ? ["迁移是否不可逆、丢数据、长时间锁表，且缺少备份/回滚/分批策略？"]
			: name === "契约破坏攻击" ? ["公开 API、CLI、事件 schema、配置或持久化格式是否发生未声明破坏？"]
			: ["diff 是否删除超时、重试、幂等、限流、熔断、恢复或可观测性保护？"],
	})),
};

/** Fail fast because angle names are stable identifiers in the verdict protocol. */
export function validateStageAttackAngles(): void {
	for (const [stage, angles] of Object.entries(STAGE_ANGLES)) {
		const seen = new Set<string>();
		for (const angle of angles) {
			if (seen.has(angle.name)) {
				throw new Error(`[xdd] AIGate stage ${stage} contains duplicate attack angle: ${angle.name}`);
			}
			seen.add(angle.name);
		}
	}
}

validateStageAttackAngles();

// ── Context file reading for cross-artifact angles ─────────────────────

/**
 * Read additional context files per stage for cross-artifact attack angles.
 *
 * Phase 6 (D) refactor: now delegates to glob-resolver.ts for:
 *   - shared glob pattern matching (resolveGlobs)
 *   - path-traversal safety (safeRealpath)
 *
 * The gate intentionally does not impose xdd-level character caps here: large
 * projects need the full declared context, and provider/model limits should be
 * surfaced by the LLM call rather than silently truncating review evidence.
 */
function readFilesUncapped(cwd: string, patterns: readonly string[]): string[] {
	const contexts: string[] = [];
	const unsafeFiles: string[] = [];
	for (const rel of resolveGlobs(cwd, patterns)) {
		const real = safeRealpath(cwd, rel);
		if (!real) {
			unsafeFiles.push(rel);
			continue;
		}
		try {
			contexts.push(`--- ${rel} ---\n${readFileSync(real, "utf8")}`);
		} catch {
			unsafeFiles.push(rel);
		}
	}
	if (unsafeFiles.length > 0) {
		contexts.push(`--- [AIGate] ${unsafeFiles.length} 个路径不安全（跳出 cwd 或不可读）---\n${unsafeFiles.join("\n")}`);
	}
	return contexts;
}

function defaultContextPatterns(stageName: string): readonly string[] {
	switch (stageName) {
		case "spec":
			// Read personas for traceability attack (recursive into any depth)
			return [".xdd/design/personas/**/*.md"];
		case "architecture":
			// Read spec rules for consistency attack (recursive -- spec/<bxx>/rules.md
			// and spec/<bxx>/sub/rules.md).
			return [".xdd/design/spec/**/*.md", ".xdd/design/spec/_landscape.md"];
		case "execute":
			// Read spec rules + architecture for implementation attack (recursive)
			return [".xdd/design/spec/**/*.md", ".xdd/design/architecture/**/*.md"];
		case "verify":
			// Read spec + architecture + plan for consistency attack (recursive)
			return [".xdd/design/spec/**/*.md", ".xdd/design/architecture/**/*.md", ".xdd/design/wire/**/*.md"];
		case "resilience":
			// Read architecture for failure mode coverage check (recursive)
			return [".xdd/design/architecture/**/*.md"];
		default:
			return [];
	}
}

function readContextFiles(cwd: string, stageName: string, contextPatterns?: readonly string[]): string[] {
	const patterns = contextPatterns && contextPatterns.length > 0 ? contextPatterns : defaultContextPatterns(stageName);
	return readFilesUncapped(cwd, patterns);
}

// ── Prompt building ────────────────────────────────────────────────────

const ATTACKER_SYSTEM_PROMPT = `你是一个极度严厉的多角度攻击审查者。你的任务是从多个攻击角度审查产物，找出问题。

你的核心纪律：
1. 默认怀疑 -- 每个角度先假设「这里有问题」，去找证据，找不到才放过。
2. 不轻易 PASS -- 要么列出攻击发现，要么明确说明「这个角度确实没问题，证据是 X」。不许「看着没问题」就过。
3. 逐角度审查 -- 每个攻击角度独立审查，给出该角度的 passed/findings。
4. 引用原文 -- 发现问题时引用产物原文片段作为证据。
5. 不给面子、不留情面、不接受"差不多"。

输出格式（只输出 JSON，不要 markdown 代码块，不要其他文字）：
{
  "passed": false,
  "angles": [
    {"name": "攻击角度名", "passed": false, "findings": ["具体问题1（引用原文）", "具体问题2"]},
    {"name": "另一个角度名", "passed": true, "findings": []}
  ],
  "issues": ["[角度名] 问题摘要1", "[角度名] 问题摘要2"],
  "suggestions": ["怎么改1", "怎么改2"]
}

passed 为 true 当且仅当所有角度都 passed。`;

/** Ask for a complete replacement after a malformed model response. */
const JSON_RETRY_INSTRUCTION = `

## 上一次输出无效
上一次响应不是可解析的单个 JSON verdict。请重新审查并只输出一个完整、严格有效的 JSON 对象。数组元素之间必须使用逗号；不要输出解释、Markdown 或第二个 JSON 对象。`;

function buildAttackUserMessage(params: {
	stageName: string;
	aigateStandard: string;
	skillName?: string;
	outputContract?: readonly { pattern: string; description: string }[];
	angles: AttackAngle[];
	artifacts: string[];
	contexts: string[];
	mechanicalCheckResult: XddGateResult;
	intentAnchor?: string;
	submissionSummary?: string;
}): string {
	const { stageName, skillName, aigateStandard, outputContract, angles, artifacts, contexts, mechanicalCheckResult, intentAnchor, submissionSummary } = params;

	const outputText = outputContract && outputContract.length > 0
		? outputContract.map((o, i) => `${i + 1}. ${o.pattern} -- ${o.description}`).join("\n")
		: "（本阶段未声明机器可审查输出；AI Gate 不得空泛通过，必须基于提交产物内容逐项说明可审查范围。）";

	const angleText = angles
		.map((a, i) => {
			const checks = a.checks.map((c) => `  - ${c}`).join("\n");
			return `### 角度 ${i + 1}: ${a.name}\n${a.description}\n攻击检查项：\n${checks}`;
		})
		.join("\n\n");
	const mechanicalCheckText = formatMechanicalCheckResult(mechanicalCheckResult);

	return `## 审查阶段：${stageName}
${skillName ? `## 对应 skill：${skillName}（检查必须对齐该 skill 的“我产出/产出/Checklist”，不能拿无关检查空跑）\n` : ""}
## 机械检查结果（本次提交的已观测输入）
${mechanicalCheckText}

这是统一 AIGate 的一个必审维度，不得标记为 "N/A"。机械检查未通过时，该角度必须为 false；机械检查通过也不能替代内容质量、需求覆盖或安全性的审查。

## 本阶段先承诺的产出（先看产出，再按对应检查审查）
${outputText}

## 审查纪律：产出-检查必须一一对齐
1. 先确认上述产出是否真实存在且非空，再审内容质量。
2. 每个攻击角度的 findings 必须引用具体产物/路径/片段；没有证据不能写“通过”。
3. 若某检查项与本 skill/本阶段产出无关，标 passed 为 "N/A" 并说明不适用原因；不要做 AI Gate 空检查。
4. 若缺少可审查产物，必须失败，不能因为没有内容而通过。

## 攻击角度（逐个独立审查，每个都要给出 passed + findings）：
${angleText}

## 阶段审查标准（额外逐条检查）：
${aigateStandard}

${submissionSummary ? `## xdd_submit_artifact.summary（提交者自述，必须与产物一致）：\n${submissionSummary}\n` : ""}

${intentAnchor ? `## 意图锚（intent.md，产物必须与此一致）：\n${intentAnchor}\n` : ""}

${contexts.length > 0 ? `## 跨产物上下文（用于一致性/可追溯性攻击）：\n${contexts.join("\n\n")}\n` : ""}

## 待审查产物内容：
${artifacts.join("\n\n")}

## 请从以上每个攻击角度审查产物，输出 JSON：`;
}

/** Render the mechanical verdict as bounded, explicit evidence for the LLM. */
export function formatMechanicalCheckResult(result: XddGateResult): string {
	const verdict = result.ok ? "通过" : "未通过";
	const mode = result.soft ? "软通过（未完成机械验证）" : "机械校验";
	const reason = result.reason?.trim() || "无补充说明";
	return `- 判定：${verdict}\n- 模式：${mode}\n- 原因/观测：${reason}`;
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runAIGate(input: AIGateInput): Promise<AIGateResult> {
	const { model, apiKey, headers, env, stageName, skillName, aigateStandard, artifactPaths, outputContract, mechanicalCheckResult, cwd, intentAnchor, contextPatterns, submissionSummary } = input;

	// Use shared glob resolution and realpath safety for artifacts, but do
	// not impose xdd-level character caps: AIGate must review the full
	// submitted files for large projects.
	const artifacts: string[] = readFilesUncapped(cwd, artifactPaths);

	// Understand stage also reads personas (for traceability attack).
	if (stageName === "understand") {
		artifacts.push(...readFilesUncapped(cwd, [".xdd/design/personas/**/*.md"]));
	}

	if (artifacts.length === 0) {
		return {
			passed: false,
			angles: [],
			issues: ["没有找到任何产物文件"],
			suggestions: ["检查产物路径是否正确"],
		};
	}

	// Read cross-artifact context for attack angles
	const contexts = readContextFiles(cwd, stageName, contextPatterns);

	// Build unified attack angles. The mechanical check is evidence and a
	// required dimension of AIGate -- it no longer makes a separate verdict.
	const stageAngles = STAGE_ANGLES[stageName] ?? [];
	const angles = [mechanicalCheckAngle(mechanicalCheckResult), ...COMMON_ANGLES, ...stageAngles];

	// Build user message
	const userMessage = buildAttackUserMessage({
		stageName,
		aigateStandard,
		skillName,
		outputContract,
		angles,
		artifacts,
		contexts,
		mechanicalCheckResult,
		intentAnchor,
		submissionSummary,
	});

	// Call LLM. Phase 6 (D) failure semantics: LLM error / timeout /
	// non-retryable HTTP failure all hard-fail (passed=false, recorded
	// in issues with the error message). The agent must see this and
	// retry manually. We do NOT soft-pass.
	let responseText: string;
	try {
		responseText = await callLLM(model, apiKey, headers, env, ATTACKER_SYSTEM_PROMPT, userMessage);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			passed: false,
			degraded: true,
			angles: angles.map((a) => ({ name: a.name, passed: "N/A" as const, findings: [] })),
			issues: [`[AIGate LLM 调用失败] ${msg}`],
			suggestions: ["检查 API key / 网络 / 模型可用性后重试"],
		};
	}

	let parsed = parseVerdict(responseText, angles);
	// Providers occasionally ignore even JSON-mode/schema constraints. A retry
	// here is deliberately limited to malformed output, rather than asking the
	// caller to resubmit unchanged artifacts or consuming the self-heal budget.
	if (parsed.degraded) {
		try {
			responseText = await callLLM(model, apiKey, headers, env, ATTACKER_SYSTEM_PROMPT, `${userMessage}${JSON_RETRY_INSTRUCTION}`);
			parsed = parseVerdict(responseText, angles);
		} catch {
			// Keep the original parse diagnostic; the retry is best-effort.
		}
	}
	// Phase 6 (D) trust-but-verify: re-derive passed from per-angle
	// results, do NOT trust the LLM's top-level passed field. If any
	// required angle is missing OR marked not-passed, overall is fail.
	return rederivePassed(parsed, angles, mechanicalCheckResult);
}

// ── LLM call ──────────────────────────────────────────────────────

/** Phase 6 (D): retry policy. Keep one retry for transient provider failures. */
const MAX_LLM_ATTEMPTS = 2;
/** Delay before retry, in ms. */
const RETRY_DELAY_MS = 1_000;

function isRetryable(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	// A timeout already consumed the complete request budget.
	if (err.name === "AbortError" || err.message.includes("timeout")) return false;
	if (/\b(?:5\d\d|429)\b/.test(err.message)) return true;
	return /fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(err.message);
}

async function callLLM(
	model: Model<any>,
	apiKey: string | undefined,
	extraHeaders: Record<string, string> | undefined,
	env: Record<string, string> | undefined,
	systemPrompt: string,
	userMessage: string,
	timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS,
): Promise<string> {
	const hasHeaderAuth = hasAuthHeader(extraHeaders);
	if (!apiKey && !hasHeaderAuth) throw new Error("无 API key 或认证 header（modelRegistry 未解析到凭证）");

	let lastErr: unknown = undefined;
	for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(new Error(`AIGate LLM call timeout after ${timeoutMs}ms`)), timeoutMs);
		try {
			const message = await complete(model, {
				systemPrompt,
				messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
			}, {
				apiKey: hasHeaderAuth ? undefined : apiKey,
				headers: extraHeaders,
				env,
				temperature: 0,
				timeoutMs,
				maxRetries: 0,
				signal: ac.signal,
			});
			return extractPiAssistantText(message);
		} catch (e) {
			lastErr = e;
			if (attempt >= MAX_LLM_ATTEMPTS || !isRetryable(e)) throw e;
			await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
		} finally {
			clearTimeout(timer);
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function hasAuthHeader(headers: Record<string, string> | undefined): boolean {
	if (!headers) return false;
	return Object.keys(headers).some((name) => /^(?:authorization|api-key|x-api-key)$/i.test(name));
}

function extractPiAssistantText(message: AssistantMessage): string {
	if (message.stopReason === "error" || message.stopReason === "aborted") {
		throw new Error(message.errorMessage || `AIGate pi-ai complete failed: ${message.stopReason}`);
	}
	const text = message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	if (!text.trim()) throw new Error("AIGate pi-ai complete returned no text content");
	return text;
}


// ── Verdict formatting ─────────────────────────────────────────────────

/** Format AIGate results as a readable multi-angle breakdown for the agent. */
export function formatAIGateResult(aiResult: AIGateResult): string {
	if (aiResult.angles.length === 0) {
		return aiResult.issues.length > 0
			? aiResult.issues.map((i, n) => `${n + 1}. ${i}`).join("\n")
			: "AIGate 判定不通过（未给出具体问题）";
	}
	const failed = aiResult.angles.filter((a) => a.passed === false);
	const passed = aiResult.angles.filter((a) => a.passed === true);
	const unavailable = aiResult.angles.filter((a) => a.passed === "N/A");
	const lines: string[] = [];
	if (unavailable.length > 0) {
		lines.push(`多角度攻击审查不可用：${unavailable.length}/${aiResult.angles.length} 角度未获得判定`);
	} else {
		lines.push(`多角度攻击审查：${failed.length}/${aiResult.angles.length} 角度发现问题`);
	}
	lines.push("");
	for (const a of failed) {
		lines.push(`❌ ${a.name}:`);
		for (const f of a.findings) lines.push(`  - ${f}`);
		lines.push("");
	}
	if (passed.length > 0) {
		lines.push(passed.map((a) => `✅ ${a.name}: 通过`).join("\n"));
	}
	if (unavailable.length > 0) {
		lines.push(unavailable.map((a) => `⚠️ ${a.name}: 审查未完成`).join("\n"));
	}
	return lines.join("\n");
}

// ── Verdict parsing + re-derivation ──────────────────────────────────

function jsonObjectCandidates(text: string): string[] {
	const candidates: string[] = [];
	for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let end = start; end < text.length; end++) {
			const char = text[end];
			if (inString) {
				if (escaped) escaped = false;
				else if (char === "\\") escaped = true;
				else if (char === '"') inString = false;
				continue;
			}
			if (char === '"') inString = true;
			else if (char === "{") depth++;
			else if (char === "}" && --depth === 0) {
				candidates.push(text.slice(start, end + 1));
				break;
			}
		}
	}
	return candidates;
}

function parseVerdict(raw: string, expectedAngles: readonly AttackAngle[]): AIGateResult {
	const truncated = raw.slice(0, 500);
	let text = raw.trim();
	text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

	const candidates = jsonObjectCandidates(text);
	if (candidates.length === 0) {
		return {
			passed: false,
			degraded: true,
			angles: expectedAngles.map((a) => ({ name: a.name, passed: false, findings: ["[AIGate 响应未包含 JSON]"] })),
			issues: ["[AIGate 解析失败] LLM 响应未找到 JSON 块"],
			suggestions: ["检查 AIGate prompt 是否清晰，重试"],
			raw: truncated,
		};
	}

	let verdict: any;
	let parseError: unknown;
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate);
			if (parsed && typeof parsed === "object" && "angles" in parsed) {
				verdict = parsed;
				break;
			}
			parseError = new Error("JSON 对象不是 AIGate verdict");
		} catch (e) {
			parseError = e;
		}
	}

	if (verdict !== undefined) {
		const angles: AIGateAngleResult[] = Array.isArray(verdict.angles)
			? verdict.angles.map((a: any) => {
					const raw = a.passed;
					let status: XddAIGateAngleStatus;
					if (raw === "N/A" || raw === "n/a" || raw === "na") {
						status = "N/A";
					} else if (raw === true || raw === "true") {
						status = true;
					} else {
						// A malformed or omitted status must never become a pass through
						// JavaScript truthiness (for example, Boolean("false") is true).
						status = false;
					}
					return {
						name: String(a.name ?? ""),
						passed: status,
						findings: Array.isArray(a.findings) ? a.findings.map(String) : [],
					};
				})
			: [];

		// Build issues from angles if not provided directly
		let issues = Array.isArray(verdict.issues) ? verdict.issues.map(String) : [];
		if (issues.length === 0 && angles.length > 0) {
			issues = angles
				.filter((a) => a.passed === false)
				.flatMap((a) => a.findings.map((f) => `[${a.name}] ${f}`));
		}

		return {
			passed: Boolean(verdict.passed),
			angles,
			issues,
			suggestions: Array.isArray(verdict.suggestions) ? verdict.suggestions.map(String) : [],
			raw: truncated,
		};
	}

	return {
		passed: false,
		degraded: true,
		angles: expectedAngles.map((a) => ({ name: a.name, passed: false, findings: ["[AIGate JSON.parse 抛错]"] })),
		issues: [`[AIGate JSON 解析失败] ${parseError instanceof Error ? parseError.message : String(parseError)}`],
		suggestions: ["检查 AIGate prompt 格式，重试"],
		raw: truncated,
	};
}

/** Phase 6 (D) trust-but-verify: re-derive the top-level passed from
 *  per-angle results. The LLM's top-level "passed" field is NOT
 *  trusted (LLMs hallucinate). Rules:
 *   - every expected angle must be present in the result
 *   - per-angle passed must be true OR "N/A" for the angle to "pass"
 *   - "N/A" is treated as a pass (the angle doesn't apply to this stage)
 *   - if any required angle is missing -> overall is fail with a clear
 *     issue ("expected angle X not in LLM response")
 */
function rederivePassed(
	parsed: AIGateResult,
	expected: readonly AttackAngle[],
	mechanicalCheckResult: XddGateResult,
): AIGateResult {
	const issues: string[] = [...parsed.issues];
	const angles = [...parsed.angles];

	// Build a name -> result map; missing angles get a synthetic "fail".
	const byName = new Map<string, AIGateAngleResult>();
	for (const a of angles) byName.set(a.name, a);

	const finalAngles: AIGateAngleResult[] = [];
	let allOk = true;
	for (const want of expected) {
		const got = byName.get(want.name);
		// The observed mechanical outcome is authoritative input to the
		// unified AIGate. Do not let an LLM hallucinate it away.
		if (want.name === "机械检查结果") {
			const finding = mechanicalCheckResult.reason?.trim() || (mechanicalCheckResult.ok ? "机械检查通过" : "机械检查未提供失败原因");
			finalAngles.push({ name: want.name, passed: mechanicalCheckResult.ok, findings: mechanicalCheckResult.ok ? [] : [finding] });
			if (!mechanicalCheckResult.ok) {
				issues.push(`[机械检查结果] ${finding}`);
				allOk = false;
			}
			continue;
		}
		if (!got) {
			// Expected angle not in LLM response -- treat as fail.
			finalAngles.push({ name: want.name, passed: false, findings: ["[AIGate] LLM 未在响应中给出此角度的判定"] });
			issues.push(`[AIGate] 缺少 ${want.name} 角度的判定（LLM 未报告）`);
			allOk = false;
			continue;
		}
		finalAngles.push(got);
		// "N/A" passes the gate; false fails; true passes.
		if (got.passed === false) {
			allOk = false;
		}
	}

	return {
		passed: allOk,
		angles: finalAngles,
		issues,
		suggestions: parsed.suggestions,
		raw: parsed.raw,
		degraded: parsed.degraded,
	};
}
