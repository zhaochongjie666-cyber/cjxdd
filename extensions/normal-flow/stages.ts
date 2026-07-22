/**
 * Normal Flow 的三阶段正向入口：拿架构文档搭框架 → TDD 完成全部 Scenario → 攻击验证。
 * 刻意不设置 plan/execute 阶段；scenario 阶段既维护可追溯场景，也逐个执行红绿重构。
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

type NfXddStageName = "architecture" | "spec" | "verify";
interface NfContractMeta {
	inputs: ArtifactRule[];
	readScopes: string[];
	writeScopes: string[];
	rollbackTarget: XddStageName | "none";
}
const NF_CONTRACT_META: Record<NfXddStageName, NfContractMeta> = {
	architecture: {
		inputs: [input("README*", "仓库说明及用户提供的架构文档（如存在）")],
		readScopes: ["**"],
		writeScopes: ["**"],
		rollbackTarget: "none",
	},
	spec: {
		inputs: [input(".xdd/design/architecture/normal/architecture.md", "框架所依据的架构决策")],
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
		rollbackPolicy: { target: meta.rollbackTarget, reason: meta.rollbackTarget === "none" ? "framework 是首阶段" : `${stage.name} 默认回退到 ${meta.rollbackTarget}` },
	};
}

const frameworkGate: XddGate = async ({ cwd }) => {
	const doc = await requireGlobsWithMinSize(cwd, [".xdd/design/architecture/normal/architecture.md"], 100);
	if (!doc.ok) return { ok: false, reason: "framework Gate: 请先读取架构输入，产出 architecture.md，再按其端点搭建可运行代码框架" };
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
		name: "architecture", role: roleFor("architecture"), skill: "xdd-architecture", exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, "bash", ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已读取用户给出的架构文档、README 与现有工程约束，并将采用的端点/模块/依赖记录到 .xdd/design/architecture/normal/architecture.md",
			"已按架构文档搭出可运行的代码框架，而不是只写另一份计划",
			"框架包含后续 Scenario 所需的端点与测试接缝，并完成最小启动/编译自检",
		],
		deliverablePaths: [".xdd/design/architecture/normal/architecture.md"], aigateStandard: NF_NO_AIGATE_STANDARD, gate: frameworkGate,
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
