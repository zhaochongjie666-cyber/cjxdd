/**
 * Normal Flow 的四阶段正向入口：完整设计链 → 搭框架 → TDD 完成全部 Scenario → 攻击验证。
 * 刻意不设置 plan/execute 阶段；design 在一个阶段内生成与 xdd 同形的持久设计产物。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireGlobs, requireGlobsWithMinSize, requireTestsPass } from "./gate.ts";
import { buildTraceCoverage, observeFilesystem } from "../xdd/observe-fs.ts";
import { globToRegExp, hasGlobMeta, walkRel } from "../xdd/gate.ts";
import { STAGE_ROLES } from "../xdd/types.ts";
import type { ArtifactRule, XddGate, XddStageName, XddStageSpec } from "../xdd/types.ts";

const roleFor = (name: XddStageName): string => STAGE_ROLES[name];
export const NF_CONTROLLER_TOOLS = ["nf_observe", "nf_desired_state", "nf_difference", "nf_submit_artifact", "nf_advance", "nf_rollback"] as const;
export const READ_TOOLS = ["read", "grep", "find", "ls"] as const;
export const WRITE_TOOLS = ["write", "edit"] as const;
const input = (pattern: string, description: string): ArtifactRule => ({ pattern, required: true, description });
const output = (pattern: string, description: string): ArtifactRule => ({ pattern, required: true, description });

type NfXddStageName = "understand" | "architecture" | "spec" | "verify";
interface NfContractMeta {
	inputs: ArtifactRule[];
	readScopes: string[];
	writeScopes: string[];
	rollbackTarget: XddStageName | "none";
}
const NF_CONTRACT_META: Record<NfXddStageName, NfContractMeta> = {
	understand: {
		inputs: [input("README*", "仓库说明与用户需求（如存在）")],
		readScopes: ["**"],
		writeScopes: [".xdd/design/**", ".xdd/runs/normal_run/**"],
		rollbackTarget: "none",
	},
	architecture: {
		inputs: [input(".xdd/design/**", "完整设计链")],
		readScopes: ["**"],
		writeScopes: ["**"],
		rollbackTarget: "understand",
	},
	spec: {
		inputs: [input(".xdd/design/**", "场景实现所依据的完整设计链")],
		readScopes: ["**"],
		writeScopes: ["**"],
		rollbackTarget: "architecture",
	},
	verify: {
		inputs: [input(".xdd/design/spec/**", "已实现的业务场景与规则")],
		readScopes: ["**"],
		writeScopes: [".xdd/runs/normal_run/verify-report.md"],
		rollbackTarget: "spec",
	},
};
const NF_NO_AIGATE_STANDARD = "NF 不启用 AIGate；以架构框架、逐 Scenario TDD 证据和最终攻击验证的硬 Gate 闭环。";

function matchingFiles(cwd: string, patterns: readonly string[]): string[] {
	let walked: string[] | undefined;
	const out = new Set<string>();
	for (const pattern of patterns) {
		if (!hasGlobMeta(pattern)) { out.add(pattern); continue; }
		walked ??= walkRel(cwd);
		const re = globToRegExp(pattern);
		for (const file of walked) if (re.test(file.replace(/\\/g, "/"))) out.add(file);
	}
	return [...out];
}
function readMatchedText(cwd: string, patterns: readonly string[]): string {
	return matchingFiles(cwd, patterns).map((rel) => {
		try { return readFileSync(join(cwd, rel), "utf8"); } catch { return ""; }
	}).join("\n");
}
function withNfStageContract(stage: XddStageSpec): XddStageSpec {
	const meta = NF_CONTRACT_META[stage.name as NfXddStageName];
	if (!meta) throw new Error(`[normal-flow] stage ${stage.name} 缺少 NF_CONTRACT_META 条目`);
	return {
		...stage,
		inputs: meta.inputs,
		outputs: stage.deliverablePaths.map((pattern) => output(pattern, `${stage.name} 必需产物 ${pattern}`)),
		readScopes: meta.readScopes,
		writeScopes: meta.writeScopes,
		gatePolicy: "hard",
		hardGate: stage.gate,
		rollbackPolicy: { target: meta.rollbackTarget, reason: meta.rollbackTarget === "none" ? "design 是首阶段" : `${stage.name} 默认回退到 ${meta.rollbackTarget}` },
	};
}

const designGate: XddGate = async ({ cwd }) => {
	const checks: Array<[string[], string]> = [
		[[".xdd/design/intent.md", ".xdd/design/design.md", ".xdd/design/personas/_index.md"], "需求意图、收敛决策或角色设计"],
		[[".xdd/design/spec/**/rules.md", ".xdd/design/spec/**/*.feature"], "RXX 规则或 Gherkin Scenario"],
		[[".xdd/design/architecture/**/architecture.md", ".xdd/design/architecture/module-landscape.md", ".xdd/design/architecture/event-contract.md", ".xdd/design/architecture/aggregate-landscape.md"], "架构、模块、事件或聚合设计"],
		[[".xdd/design/wire/*.md"], "交互线框与操作状态设计"],
		[[".xdd/design/architecture/**/resilience/failure-modes.md", ".xdd/design/architecture/**/resilience/failsafe-design.md", ".xdd/design/architecture/**/resilience/resilience-test-plan.md"], "失败模式、兜底或韧性测试设计"],
	];
	for (const [patterns, label] of checks) {
		for (const pattern of patterns) {
			const result = await requireGlobs(cwd, [pattern]);
			if (!result.ok) return { ok: false, reason: `design Gate: 缺少${label}；请按 understand→spec→architecture→wire→resilience 的正向顺序补齐：${pattern}` };
		}
	}
	const personaFiles = matchingFiles(cwd, [".xdd/design/personas/*.md"])
		.filter((path) => !path.endsWith("/_index.md"));
	if (personaFiles.length === 0) return { ok: false, reason: "design Gate: personas 只有索引而没有角色档案；请按 xdd understand 正向动作补至少一个具体角色的深度档案" };
	return { ok: true };
};

const frameworkGate: XddGate = async ({ cwd }) => {
	const doc = await requireGlobsWithMinSize(cwd, [".xdd/design/architecture/**/architecture.md"], 100);
	if (!doc.ok) return { ok: false, reason: "framework Gate: 完整设计链中的 architecture.md 缺失或过短；请先回 design 补齐，再按其端点搭建框架" };
	const framework = await requireGlobs(cwd, ["src/**", "lib/**", "app/**", "cmd/**"]);
	if (!framework.ok) return { ok: false, reason: "framework Gate: 架构文档已有，但缺少 src/lib/app/cmd 中的代码框架；请回到正向动作搭建架构端点" };
	return { ok: true };
};

const scenariosGate: XddGate = async ({ cwd }) => {
	const rules = await requireGlobsWithMinSize(cwd, [".xdd/design/spec/**/rules.md"], 100);
	if (!rules.ok) return { ok: false, reason: "scenarios Gate: 缺少规则锚；请从架构能力提取 RXX 并写入 rules.md" };
	const features = await requireGlobs(cwd, [".xdd/design/spec/**/*.feature"]);
	if (!features.ok) return { ok: false, reason: "scenarios Gate: 缺少 .feature；请列出全部正向与兜底 Scenario" };
	const coverage = buildTraceCoverage(observeFilesystem(cwd, []));
	if (coverage.specRxx.length === 0) return { ok: false, reason: "scenarios Gate: 未发现 RXX；请为 Scenario 建立可追溯规则锚" };
	const text = readMatchedText(cwd, [".xdd/design/spec/**/rules.md", ".xdd/design/spec/**/*.feature"]);
	if (!/(@covers-)?(?:B\d{2}-)?R\d{2}/.test(text)) return { ok: false, reason: "scenarios Gate: Scenario 未绑定 RXX" };
	if (coverage.unimplemented.length > 0) return { ok: false, reason: `scenarios Gate: 以下规则尚未完成红→绿 TDD 或缺少 @implements：${coverage.unimplemented.join(", ")}` };
	const tests = await requireTestsPass(cwd);
	if (!tests.ok) return { ok: false, reason: `scenarios Gate: 测试未通过；回到对应 Scenario 的失败测试并完成最小实现。${tests.reason ?? ""}` };
	return { ok: true };
};

const verifyGate: XddGate = async ({ cwd }) => {
	const report = await requireGlobsWithMinSize(cwd, [".xdd/runs/normal_run/verify-report.md"], 100);
	if (!report.ok) return { ok: false, reason: "verify Gate: 缺少逐 Scenario 的攻击验证报告" };
	const tests = await requireTestsPass(cwd);
	if (!tests.ok) return tests;
	const coverage = buildTraceCoverage(observeFilesystem(cwd, []));
	if (coverage.specRxx.length === 0 || coverage.unimplemented.length > 0 || coverage.orphan.length > 0) {
		return { ok: false, reason: `verify Gate: spec↔code 未闭合（未实现: ${coverage.unimplemented.join(", ") || "无"}；孤儿: ${coverage.orphan.join(", ") || "无"}）；实现问题回 scenarios，架构根因回 framework` };
	}
	return { ok: true };
};

export const NF_STAGES: readonly XddStageSpec[] = [
	{
		name: "understand", role: roleFor("understand"), skill: "xdd-brainstorm", exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已生成与 xdd 同形的完整持久设计链，而不是简化版 architecture/spec",
			"需求层已完成 intent.md、design.md 与 personas；规格层已完成 RXX rules.md 与全部正向/兜底 Feature Scenario",
			"架构层已完成各业务 architecture.md、module-landscape.md、event-contract.md 与 aggregate-landscape.md",
			"交互层已完成 wire 页面及空/加载/错误/成功/确认/边界状态；韧性层已完成 failure-modes、failsafe-design 与 resilience-test-plan",
			"各层通过 RXX 保持追溯，正向设计和失败兜底均可供后续 framework/scenarios 直接消费",
		],
		deliverablePaths: [
			".xdd/design/intent.md", ".xdd/design/design.md", ".xdd/design/personas/_index.md",
			".xdd/design/spec/**/rules.md", ".xdd/design/spec/**/*.feature",
			".xdd/design/architecture/**/architecture.md", ".xdd/design/architecture/module-landscape.md",
			".xdd/design/architecture/event-contract.md", ".xdd/design/architecture/aggregate-landscape.md",
			".xdd/design/wire/*.md", ".xdd/design/architecture/**/resilience/failure-modes.md",
			".xdd/design/architecture/**/resilience/failsafe-design.md", ".xdd/design/architecture/**/resilience/resilience-test-plan.md",
		],
		aigateStandard: NF_NO_AIGATE_STANDARD, gate: designGate, noCodeReading: true,
	},
	{
		name: "architecture", role: roleFor("architecture"), skill: "xdd-architecture", exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, "bash", ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已读取 design 阶段的 intent/spec/architecture/wire/resilience 完整设计链",
			"已按完整架构文档搭出可运行的代码框架，而不是重写设计或补计划",
			"框架包含后续 Scenario 所需的端点与测试接缝，并完成最小启动/编译自检",
		],
		deliverablePaths: [], aigateStandard: NF_NO_AIGATE_STANDARD, gate: frameworkGate,
	},
	{
		name: "spec", role: roleFor("spec"), skill: "xdd-execute", exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, "bash", ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已从需求与架构能力列全 RXX 和 Gherkin Scenario，正向与失败/拒绝/冲突/无权限/边界兜底都不遗漏",
			"已按 Scenario 逐个执行红→绿→重构：先看到失败测试，再写最小实现，再跑回归",
			"每条 RXX 都有测试证据和源码 @implements RXX，全部 Scenario 测试通过",
			"失败 Gate 能指出具体 RXX/Scenario，并直接给出回炉动作，而不是要求补 plan",
		],
		deliverablePaths: [".xdd/design/spec/**/rules.md", ".xdd/design/spec/**/*.feature"], aigateStandard: NF_NO_AIGATE_STANDARD, gate: scenariosGate,
	},
	{
		name: "verify", role: roleFor("verify"), skill: "xdd-verify", exit: "verdict",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, "bash", ...NF_CONTROLLER_TOOLS], noCodeModification: true,
		desiredState: [
			"已逐 Scenario 重跑测试并主动攻击正向与兜底路径",
			"verify-report.md 记录命令、失败证据、P0/P1、追溯覆盖及回炉去向",
			"实现问题可回 scenarios 继续 TDD；架构问题可回 framework 重搭框架",
		],
		deliverablePaths: [".xdd/runs/normal_run/verify-report.md"], aigateStandard: NF_NO_AIGATE_STANDARD, gate: verifyGate,
	},
].map(withNfStageContract);
