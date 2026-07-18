/**
 * Normal Flow 的 5 阶段定义。复用 xdd 的 XddStageSpec/XddStageName 类型和 gate
 * helper，只用其中 5 个 xdd 阶段名（understand/spec/plan/execute/verify），不
 * 引入新的 stage 名字面量，保持 runtime.json 与 xdd 完全兼容（见 types.ts）。
 *
 * NF 没有 init/architecture/wire/resilience/cleanup 阶段：
 *  - 没有 init：flow.ts 的 start 流程直接调 xdd 的 controllerInitScaffold() 建
 *    .xdd/ 骨架，不需要单独的 init 阶段来"复述目标"。
 *  - 没有 architecture/wire/resilience/cleanup：这是 NF 相对 xdd 的核心简化。
 *
 * `compileStageContracts()`（extensions/xdd/core/stage-contract.ts）在阶段激活
 * 时强制校验 inputs/outputs/readScopes/writeScopes/gatePolicy/hardGate/
 * rollbackPolicy 七个字段全部非空，`outputs` 里 required 的 pattern 还必须被
 * writeScopes 覆盖。xdd 自己的 10 个阶段靠 stages.ts 内一个未导出的
 * withStageContract() + CONTRACT_META 表补全这些字段——这套私有机制不能被 NF
 * import，下面的 NF_CONTRACT_META + withNfStageContract 是 NF 自己的等价物。
 *
 * rollbackPolicy 的常见坑：explore 是 NF 的第一个阶段（NF 没有 init），
 * rollbackPolicy.target 必须是 "none"，不能像 xdd 的 understand 阶段那样写
 * "init"——NF 的 stages 数组里根本没有这个 stage 名，compileStageContracts 会
 * 因为 rollback target 找不到而拒绝激活。同理 plan 阶段的上游是 spec（不是 xdd
 * 的 resilience，NF 没有这个阶段）。
 */
import {
	requireGlobs,
	requireGlobsWithKeywords,
	requireGlobsWithMinSize,
	requireTestsPass,
} from "./gate.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTraceCoverage, observeFilesystem } from "../xdd/observe-fs.ts";
import { globToRegExp, hasGlobMeta, walkRel } from "../xdd/gate.ts";
import { STAGE_ROLES } from "../xdd/types.ts";
import type { ArtifactRule, XddGate, XddStageName, XddStageSpec } from "../xdd/types.ts";

const roleFor = (name: XddStageName): string => STAGE_ROLES[name];

/** 每个 NF 阶段都能用的控制循环工具。 */
export const NF_CONTROLLER_TOOLS = [
	"nf_observe",
	"nf_desired_state",
	"nf_difference",
	"nf_submit_artifact",
	"nf_advance",
	"nf_rollback",
] as const;
export const READ_TOOLS = ["read", "grep", "find", "ls"] as const;
export const WRITE_TOOLS = ["write", "edit"] as const;

const input = (pattern: string, description: string): ArtifactRule => ({ pattern, required: true, description });
const output = (pattern: string, description: string): ArtifactRule => ({ pattern, required: true, description });

interface NfContractMeta {
	inputs: ArtifactRule[];
	readScopes: string[];
	writeScopes: string[];
	gatePolicy: "hard";
	rollbackTarget: XddStageName | "none";
}

type NfXddStageName = "understand" | "spec" | "plan" | "execute" | "verify";

/**
 * NF 阶段的 StageContract 补全表，仿照 xdd stages.ts 内私有的 CONTRACT_META。
 * 只覆盖 NF 用到的 5 个 xdd 阶段名；键名沿用 xdd 名，不是 NF display name。
 */
const NF_CONTRACT_META: Record<NfXddStageName, NfContractMeta> = {
	understand: {
		inputs: [input("README*", "仓库 README/说明文档（如存在）")],
		readScopes: ["**/*.md", ".xdd/**", "package.json", "pyproject.toml", "Cargo.toml"],
		writeScopes: [".xdd/design/**", ".xdd/runs/**"],
		gatePolicy: "hard",
		// explore 是 NF 的第一个阶段（NF 没有 init 阶段），没有更早的阶段可回退。
		rollbackTarget: "none",
	},
	spec: {
		inputs: [
			input(".xdd/design/design.md", "收敛设计决策"),
			input(".xdd/design/intent.md", "意图锚与成功标准"),
		],
		readScopes: [".xdd/design/**", ".xdd/runs/**"],
		writeScopes: [".xdd/design/**"],
		gatePolicy: "hard",
		rollbackTarget: "understand",
	},
	plan: {
		inputs: [input(".xdd/design/**", "完整设计输入")],
		readScopes: [
			".xdd/design/**", "README*", "docs/**",
			"package.json", "pyproject.toml", "Cargo.toml",
			"src/**", "lib/**", "app/**", "tests/**",
		],
		writeScopes: [".xdd/runs/**/plan.md", ".xdd/runs/**/plan/**"],
		gatePolicy: "hard",
		// NF 没有 architecture/wire/resilience，plan 的直接上游是 spec。
		rollbackTarget: "spec",
	},
	execute: {
		inputs: [
			input(".xdd/runs/**/plan.md", "当前迭代执行计划"),
			input(".xdd/design/**", "设计契约"),
		],
		readScopes: ["**"],
		writeScopes: ["**"],
		gatePolicy: "hard",
		rollbackTarget: "plan",
	},
	verify: {
		inputs: [
			input(".xdd/runs/**/plan.md", "当前迭代计划"),
			input(".xdd/design/spec/**", "业务验收规则"),
		],
		readScopes: ["**"],
		writeScopes: [".xdd/runs/**/verify-report.md"],
		gatePolicy: "hard",
		rollbackTarget: "execute",
	},
};

/** NF 不启用 AIGate；这段占位标准写死在每个阶段，满足 aigateStandard 必填约束。 */
const NF_NO_AIGATE_STANDARD =
	"NF 不启用 AIGate；语义质量由 spec/plan/execute/verify 的攻击清单、TDD 证据和硬 Gate 协同负责，不做外部多角度 LLM 审查。";

const NF_ATTACK_KEYWORDS = ["Attack", "攻击", "异常", "失败", "拒绝", "无权限", "冲突"] as const;
const NF_PLAN_DISCIPLINE_KEYWORDS = ["回指 RXX", "Expected:", "Files:", "Attack", "攻击", "Gate"] as const;
const NF_VERIFY_ATTACK_KEYWORDS = ["攻击", "Attack", "失败假设", "P0", "P1", "证据", "spec↔code"] as const;

function matchingFiles(cwd: string, patterns: readonly string[]): string[] {
	let walked: string[] | undefined;
	const out = new Set<string>();
	for (const pattern of patterns) {
		if (!hasGlobMeta(pattern)) {
			out.add(pattern);
			continue;
		}
		if (walked === undefined) walked = walkRel(cwd);
		const re = globToRegExp(pattern);
		for (const file of walked) {
			const rel = file.replace(/\\/g, "/");
			if (re.test(rel)) out.add(rel);
		}
	}
	return [...out];
}

function readMatchedText(cwd: string, patterns: readonly string[]): string {
	return matchingFiles(cwd, patterns).map((rel) => {
		try {
			return readFileSync(join(cwd, rel), "utf8");
		} catch {
			return "";
		}
	}).join("\n");
}

function missingKeywords(content: string, keywords: readonly string[]): string[] {
	return keywords.filter((keyword) => !content.includes(keyword));
}

function withNfStageContract(stage: XddStageSpec): XddStageSpec {
	const meta = NF_CONTRACT_META[stage.name as NfXddStageName];
	if (!meta) throw new Error(`[normal-flow] stage ${stage.name} 缺少 NF_CONTRACT_META 条目`);
	const outputs = stage.deliverablePaths.map((pattern) => output(pattern, `${stage.name} 必需产物 ${pattern}`));
	return {
		...stage,
		inputs: meta.inputs,
		outputs,
		readScopes: meta.readScopes,
		writeScopes: meta.writeScopes,
		gatePolicy: meta.gatePolicy,
		hardGate: stage.gate,
		rollbackPolicy: {
			target: meta.rollbackTarget,
			reason: meta.rollbackTarget === "none"
				? "explore 是 NF 的首个阶段，无回退目标"
				: `${stage.name} 默认回退到 ${meta.rollbackTarget}`,
		},
		// aiGate 留空（undefined）：validateAiGateArtifacts 在 aiGate?.enabled 为
		// 假时直接放行，不需要显式写 { enabled: false, ... } 占位对象。
	};
}

const exploreGate: XddGate = async ({ cwd }) => {
	const intentOk = await requireGlobs(cwd, [".xdd/design/intent.md"]);
	if (!intentOk.ok) return { ok: false, reason: "explore Gate: 缺少 .xdd/design/intent.md" };
	const designOk = await requireGlobsWithKeywords(
		cwd,
		[".xdd/design/design.md"],
		["Selected", "Alternatives", "Assumptions", "Out of Scope", "Open Questions"],
		3,
	);
	if (!designOk.ok) return { ok: false, reason: "explore Gate: .xdd/design/design.md 缺少收敛决策 5 段（至少 3 段）" };
	return { ok: true };
};

const specGate: XddGate = async ({ cwd }) => {
	const rulesOk = await requireGlobsWithMinSize(cwd, [".xdd/design/spec/**/rules.md"], 100);
	if (!rulesOk.ok) return { ok: false, reason: "spec Gate: 缺少或过短的 .xdd/design/spec/**/rules.md（RXX 规则目录）" };
	const featOk = await requireGlobs(cwd, [".xdd/design/spec/**/*.feature"]);
	if (!featOk.ok) return { ok: false, reason: "spec Gate: 缺少 .xdd/design/spec/**/*.feature（每条 RXX 至少 1 个场景）" };
	const coverage = buildTraceCoverage(observeFilesystem(cwd, []));
	if (coverage.specRxx.length === 0) return { ok: false, reason: "spec Gate: rules.md 中未发现 RXX 规则编号；请声明至少一条 R01 或 B01-R01 形式的可追溯规则" };
	const specText = readMatchedText(cwd, [".xdd/design/spec/**/rules.md", ".xdd/design/spec/**/*.feature"]);
	if (!/(@covers-)?(?:B\d{2}-)?R\d{2}/.test(specText)) return { ok: false, reason: "spec Gate: Feature/规则未显式绑定 RXX，开发无法按锚实现" };
	if (!NF_ATTACK_KEYWORDS.some((keyword) => specText.includes(keyword))) return { ok: false, reason: "spec Gate: 缺少攻击/异常路径描述；每条核心规则至少要有拒绝、失败、冲突或无权限等反例" };
	return { ok: true };
};

const planGate: XddGate = async ({ cwd }) => {
	const planOk = await requireGlobsWithMinSize(cwd, [".xdd/runs/**/plan.md"], 100);
	if (!planOk.ok) return planOk;
	const coverage = buildTraceCoverage(observeFilesystem(cwd, []));
	if (coverage.specRxx.length === 0) return { ok: false, reason: "plan Gate: 未发现 spec RXX，不能产出可追溯开发计划" };
	const planText = readMatchedText(cwd, [".xdd/runs/**/plan.md"]);
	const missingPlan = missingKeywords(planText, NF_PLAN_DISCIPLINE_KEYWORDS);
	if (missingPlan.length > 0) return { ok: false, reason: `plan Gate: plan.md 缺少开发↔Gate 协同字段：${missingPlan.join(", ")}` };
	return { ok: true };
};

const implementGate: XddGate = async ({ cwd }) => {
	const coverage = buildTraceCoverage(observeFilesystem(cwd, []));
	if (coverage.specRxx.length === 0) return { ok: false, reason: "implement Gate: 未发现 spec RXX，不能验证实现追溯；请先回到 spec 阶段产出规则编号" };
	if (coverage.unimplemented.length > 0) return { ok: false, reason: `implement Gate: 以下 spec RXX 尚无源码 @implements 标注：${coverage.unimplemented.join(", ")}` };
	const planText = readMatchedText(cwd, [".xdd/runs/**/plan.md"]);
	const missingPlan = missingKeywords(planText, NF_PLAN_DISCIPLINE_KEYWORDS);
	if (missingPlan.length > 0) return { ok: false, reason: `implement Gate: 开发计划缺少攻击/TDD/Gate 协同字段：${missingPlan.join(", ")}` };
	const testsOk = await requireTestsPass(cwd);
	if (!testsOk.ok) return testsOk;
	return { ok: true };
};

const verifyGate: XddGate = async ({ cwd }) => {
	const reportOk = await requireGlobsWithMinSize(cwd, [".xdd/runs/*/verify-report.md"], 100);
	if (!reportOk.ok) return { ok: false, reason: "verify Gate: 缺少或过短的 .xdd/runs/iter-N/verify-report.md" };
	const testsOk = await requireTestsPass(cwd);
	if (!testsOk.ok) return testsOk;
	const coverage = buildTraceCoverage(observeFilesystem(cwd, []));
	if (coverage.specRxx.length === 0) return { ok: false, reason: "verify Gate: 未发现 spec RXX，无法证明 spec↔code 追溯闭合" };
	const verifyText = readMatchedText(cwd, [".xdd/runs/*/verify-report.md"]);
	const missingVerify = missingKeywords(verifyText, NF_VERIFY_ATTACK_KEYWORDS);
	if (missingVerify.length > 0) return { ok: false, reason: `verify Gate: verify-report.md 缺少攻击验证证据字段：${missingVerify.join(", ")}` };
	if (coverage.unimplemented.length > 0 || coverage.orphan.length > 0) {
		const gaps = [
			coverage.unimplemented.length > 0 ? `未实现: ${coverage.unimplemented.join(", ")}` : "",
			coverage.orphan.length > 0 ? `孤儿标注: ${coverage.orphan.join(", ")}` : "",
		].filter(Boolean).join("；");
		return { ok: false, reason: `verify Gate: spec↔code 追溯未闭合（${gaps}）` };
	}
	return { ok: true };
};

export const NF_STAGES: readonly XddStageSpec[] = [
	{
		name: "understand",
		role: roleFor("understand"),
		skill: "xdd-brainstorm",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已读完前序产物（仓库 README / docs/）",
			"已产出意图锚 .xdd/design/intent.md（1 句话定位 + 可验证成功标准 + 非目标）",
			"已产出 .xdd/design/design.md（5 段：Selected / Alternatives / Assumptions / Out of Scope / Open Questions）",
		],
		deliverablePaths: [".xdd/design/intent.md", ".xdd/design/design.md"],
		noCodeReading: true,
		aigateStandard: NF_NO_AIGATE_STANDARD,
		gate: exploreGate,
	},
	{
		name: "spec",
		role: roleFor("spec"),
		skill: "xdd-spec",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已产出可验收的业务规则（RXX）+ Gherkin 场景（.xdd/design/spec/{bxx}/rules.md + *.feature）",
			"每条 RXX 规则至少 1 个 Feature 覆盖（含正向 + 异常 Scenario）",
			"已把攻击面写入规则：拒绝/失败/冲突/无权限/边界反例，而不是只写 happy path",
			"规则与 explore 阶段澄清的需求点逐条对应（无遗漏假设）",
		],
		deliverablePaths: [".xdd/design/spec/**/rules.md", ".xdd/design/spec/**/*.feature"],
		noCodeReading: true,
		aigateStandard: NF_NO_AIGATE_STANDARD,
		gate: specGate,
	},
	{
		name: "plan",
		role: roleFor("plan"),
		skill: "xdd-plan",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已产出执行计划文档（.xdd/runs/iter-N/plan.md）",
			"每项工作项标明：依赖前序产出、预计产物、改动文件范围",
			"每个工作项关联至少 1 条 spec RXX",
			"每个工作项写清 TDD 验证命令/Expected 结果、改动 Files、Gate 通过条件和攻击用例",
		],
		deliverablePaths: [".xdd/runs/**/plan.md"],
		aigateStandard: NF_NO_AIGATE_STANDARD,
		gate: planGate,
	},
	{
		name: "execute",
		role: roleFor("execute"),
		skill: "xdd-execute",
		exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, "bash", ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已按 plan 工作项完成实现",
			"每条 spec RXX 都有对应的 @implements RXX 标注",
			"测试通过（npm test / go test / make test，按仓库类型自动探测）",
			"实现按 plan 的攻击用例补了失败测试，且 Gate 失败原因能回指到具体 RXX/Task",
		],
		deliverablePaths: [],
		aigateStandard: NF_NO_AIGATE_STANDARD,
		gate: implementGate,
	},
	{
		name: "verify",
		role: roleFor("verify"),
		skill: "xdd-verify",
		exit: "verdict",
		allowedTools: [...READ_TOOLS, "bash", ...NF_CONTROLLER_TOOLS],
		noCodeModification: true,
		desiredState: [
			"已对 spec 的每条 RXX 规则至少跑一次验证",
			"已写 .xdd/runs/iter-N/verify-report.md，逐 RXX 举证",
			"测试通过；spec↔code 追溯闭合（@implements RXX 齐全）",
			"verify-report.md 包含攻击验证、P0/P1 判定、失败假设和证据路径，能驱动回 execute 或更早阶段",
		],
		deliverablePaths: [".xdd/runs/*/verify-report.md"],
		aigateStandard: NF_NO_AIGATE_STANDARD,
		gate: verifyGate,
	},
].map(withNfStageContract);
