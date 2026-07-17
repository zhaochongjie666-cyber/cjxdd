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
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai/compat";
import { readCappedFiles, resolveGlobs } from "./glob-resolver.ts";
import type { XddGateResult } from "./types.ts";

/**
 * AIGate reviews several artifacts and returns one verdict per attack angle.
 * A ten-minute window accommodates slower compatible providers when
 * architecture submissions also include cross-stage context.
 */
const MIN_LLM_TIMEOUT_MS = 15_000;
const MAX_LLM_TIMEOUT_MS = 600_000;
const MAX_AIGATE_ARTIFACT_CHARS = 32_000;
const MAX_AIGATE_CONTEXT_CHARS = 32_000;
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

/** Design-layer angle: design/ is persistent across iters, must not reference iter-N. */
const ITER_POLLUTION_ANGLE: AttackAngle = {
	name: "iter污染攻击",
	description: "design/ 是持久锚，跨 iter 保留，不引用 iter-N",
	checks: [
		"design/ 下的产物是否引用了 iter-N？（如 .xdd/runs/iter-N/goals.md 路径出现在 design.md/rules.md/architecture.md/wire/*.md 中）",
		"产物是否用 iter 编号限定持久设计？（如 'iter-1 的架构' 应该是 '架构'，不绑定 iter）",
		"design/ 下的文件路径是否指向 runs/iter-N/？（design 层不该关心具体 iter 编号）",
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
			description: "迭代结束时，验证过的“感悟”是否提升到 design/，pilot 的留在 runs/",
			checks: [
				"本 iter 验证中发现的新规则/约束是否提升到 design/spec/rules.md？",
				"架构中发现的新模式/反模式是否提升到 design/architecture/？",
				"失败模式/兜底策略是否提升到 design/architecture/*/resilience/？",
				"PoC/实验结果/临时方案是否留在 runs/iter-N/（未提升到 design/）？",
				"design/ 产物是否仍不引用 iter-N（提升的内容是跨 iter 结论，不绑定迭代编号）？",
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
};

// ── Context file reading for cross-artifact angles ─────────────────────

/**
 * Read additional context files per stage for cross-artifact attack angles.
 *
 * Phase 6 (D) refactor: now delegates to glob-resolver.ts for:
 *   - shared glob pattern matching (resolveGlobs)
 *   - per-file + total size caps (DEFAULT_MAX_FILE_CHARS, DEFAULT_MAX_TOTAL_CHARS)
 *   - path-traversal safety (safeRealpath inside readCappedFiles)
 */
function readContextFiles(cwd: string, stageName: string): string[] {
	const contexts: string[] = [];
	const MAX_TOTAL = MAX_AIGATE_CONTEXT_CHARS;

	// Helper: read a list of patterns and append to contexts.
	const readPats = (pats: readonly string[]): void => {
		const rels = resolveGlobs(cwd, pats);
		const result = readCappedFiles(cwd, rels, { maxTotalChars: MAX_TOTAL });
		for (const f of result.files) {
			contexts.push(`--- ${f.rel} ---\n${f.content}`);
		}
		if (result.unsafeFiles.length > 0) {
			contexts.push(`--- [AIGate] ${result.unsafeFiles.length} 个路径不安全（跳出 cwd 或不可读）---\n${result.unsafeFiles.join("\n")}`);
		}
	};

	switch (stageName) {
		case "spec":
			// Read personas for traceability attack (recursive into any depth)
			readPats([".xdd/design/personas/**/*.md"]);
			break;
		case "architecture":
			// Read spec rules for consistency attack (recursive -- spec/<bxx>/rules.md
			// and spec/<bxx>/sub/rules.md).
			readPats([".xdd/design/spec/**/*.md", ".xdd/design/spec/_landscape.md"]);
			break;
		case "execute":
			// Read spec rules + architecture for implementation attack (recursive)
			readPats([".xdd/design/spec/**/*.md", ".xdd/design/architecture/**/*.md"]);
			break;
		case "verify":
			// Read spec + architecture + plan for consistency attack (recursive)
			readPats([".xdd/design/spec/**/*.md", ".xdd/design/architecture/**/*.md", ".xdd/design/wire/**/*.md"]);
			break;
		case "resilience":
			// Read architecture for failure mode coverage check (recursive)
			readPats([".xdd/design/architecture/**/*.md"]);
			break;
	}

	return contexts;
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
}): string {
	const { stageName, skillName, aigateStandard, outputContract, angles, artifacts, contexts, mechanicalCheckResult, intentAnchor } = params;

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
	const { model, apiKey, headers, stageName, skillName, aigateStandard, artifactPaths, outputContract, mechanicalCheckResult, cwd, intentAnchor } = input;

	// Phase 6 (D): use shared resolver for artifacts. Applies realpath
	// safety + per-file + total size caps. Symlinks pointing outside cwd
	// are silently dropped and reported as `unsafeFiles`.
	// Bound the full request while retaining enough architecture and spec context
	// for a complete cross-artifact review.
	const artifactResult = readCappedFiles(cwd, artifactPaths, { maxFileChars: 8_000, maxTotalChars: MAX_AIGATE_ARTIFACT_CHARS });
	const artifacts: string[] = artifactResult.files.map((f) => `--- ${f.rel} ---\n${f.content}`);

	// Understand stage also reads personas (for traceability attack).
	if (stageName === "understand") {
		const personaResult = readCappedFiles(cwd, [".xdd/design/personas/**/*.md"], { maxTotalChars: 8_000 });
		for (const f of personaResult.files) {
			artifacts.push(`--- ${f.rel} ---\n${f.content}`);
		}
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
	const contexts = readContextFiles(cwd, stageName);

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
	});

	// Call LLM. Phase 6 (D) failure semantics: LLM error / timeout /
	// non-retryable HTTP failure all hard-fail (passed=false, recorded
	// in issues with the error message). The agent must see this and
	// retry manually. We do NOT soft-pass.
	let responseText: string;
	try {
		responseText = await callLLM(model, apiKey, headers, ATTACKER_SYSTEM_PROMPT, userMessage);
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

	const parsed = parseVerdict(responseText, angles);
	// Phase 6 (D) trust-but-verify: re-derive passed from per-angle
	// results, do NOT trust the LLM's top-level passed field. If any
	// required angle is missing OR marked not-passed, overall is fail.
	return rederivePassed(parsed, angles, mechanicalCheckResult);
}

// ── LLM call ──────────────────────────────────────────────────────

/** Phase 6 (D): retry policy. Only retry on transient errors:
 *   - network (TypeError, fetch failed)
 *   - 5xx HTTP
 *   - 429 rate limit
 * Do NOT retry a timeout: repeating the identical expensive request merely
 * makes the agent wait another full timeout and cannot yield a verdict.
 * Do NOT retry on 4xx other than 429 (auth failure, bad request won't get
 * better with another shot). Max 1 retry (2 attempts total) for transient
 * transport and server failures. */
const MAX_LLM_ATTEMPTS = 2;
/** Delay before retry, in ms. */
const RETRY_DELAY_MS = 1_000;

function isRetryable(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	// A timeout already consumed the complete request budget.
	if (err.name === "AbortError" || err.message.includes("timeout")) return false;
	// Network failures (fetch throws TypeError)
	if (err.name === "TypeError") return true;
	// 5xx / 429 in the error message we wrap
	const m = /API (\d{3})/.exec(err.message);
	if (m) {
		const code = Number(m[1]);
		return code >= 500 || code === 429;
	}
	return false;
}

async function callLLM(
	model: Model<any>,
	apiKey: string | undefined,
	extraHeaders: Record<string, string> | undefined,
	systemPrompt: string,
	userMessage: string,
	timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS,
): Promise<string> {
	if (!apiKey) throw new Error("无 API key（modelRegistry 未解析到凭证）");

	const api = model.api;
	const baseUrl = model.baseUrl.replace(/\/$/, "");

	let lastErr: unknown = undefined;
	for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
		// AbortController + timeout: without this, a stuck LLM call
		// would hang the entire xdd run forever.
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(new Error(`AIGate LLM call timeout after ${timeoutMs}ms`)), timeoutMs);
		try {
			const text = await callLLMOnce(ac, api, baseUrl, model, apiKey, extraHeaders, systemPrompt, userMessage);
			return text;
		} catch (e) {
			lastErr = e;
			if (attempt >= MAX_LLM_ATTEMPTS || !isRetryable(e)) {
				throw e;
			}
			// Backoff before retry
			await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
		} finally {
			clearTimeout(timer);
		}
	}
	// Unreachable (loop either returns or throws on last attempt).
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function callLLMOnce(
	ac: AbortController,
	api: string,
	baseUrl: string,
	model: Model<any>,
	apiKey: string,
	extraHeaders: Record<string, string> | undefined,
	systemPrompt: string,
	userMessage: string,
): Promise<string> {
	if (api === "anthropic-messages") {
		const res = await fetch(`${baseUrl}/messages`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				...(extraHeaders ?? {}),
			},
			body: JSON.stringify({
				model: model.id,
				max_tokens: 12_000,
				system: systemPrompt,
				messages: [{ role: "user", content: userMessage }],
			}),
			signal: ac.signal,
		});
		if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
		const data = await res.json();
		return data.content?.map((c: any) => c.text).join("") ?? "";
	}

	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
			...(extraHeaders ?? {}),
		},
		body: JSON.stringify({
			model: model.id,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage },
			],
			temperature: 0,
			max_tokens: 12_000,
		}),
		signal: ac.signal,
	});
	if (!res.ok) throw new Error(`LLM API ${res.status}: ${await res.text()}`);
	const data = await res.json();
	return data.choices?.[0]?.message?.content ?? "";
}

// ── Verdict formatting ─────────────────────────────────────────────────

/** Format AIGate results as a readable multi-angle breakdown for the agent. */
export function formatAIGateResult(aiResult: AIGateResult): string {
	if (aiResult.angles.length === 0) {
		// No angle breakdown (LLM parse failure or no artifacts)
		return aiResult.issues.length > 0
			? aiResult.issues.map((i, n) => `${n + 1}. ${i}`).join("\n")
			: "AIGate 判定不通过（未给出具体问题）";
	}
	// Do not use truthiness here: the string "N/A" is truthy, but it means
	// the review did not produce a verdict for that angle. Treating it as a
	// green pass was especially misleading for transport failures: the tool
	// reported "0/N issues" and every angle as passed while the gate correctly
	// returned `passed: false`.
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

/** Parse the LLM response. Phase 6 (D) failure semantics: any parse
 *  error (no JSON, JSON.parse throws) returns a hard-fail result with
 *  `degraded: true` and ALL angles marked as failed. The caller
 *  (rederivePassed) will then fail the gate. */
function parseVerdict(raw: string, expectedAngles: readonly AttackAngle[]): AIGateResult {
	const truncated = raw.slice(0, 500);
	let text = raw.trim();
	text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		return {
			passed: false,
			degraded: true,
			angles: expectedAngles.map((a) => ({ name: a.name, passed: false, findings: ["[AIGate 响应未包含 JSON]"] })),
			issues: ["[AIGate 解析失败] LLM 响应未找到 JSON 块"],
			suggestions: ["检查 AIGate prompt 是否清晰，重试"],
			raw: truncated,
		};
	}

	try {
		const verdict = JSON.parse(jsonMatch[0]);
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
	} catch (e) {
		return {
			passed: false,
			degraded: true,
			angles: expectedAngles.map((a) => ({ name: a.name, passed: false, findings: ["[AIGate JSON.parse 抛错]"] })),
			issues: [`[AIGate JSON 解析失败] ${e instanceof Error ? e.message : String(e)}`],
			suggestions: ["检查 AIGate prompt 格式，重试"],
			raw: truncated,
		};
	}
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
