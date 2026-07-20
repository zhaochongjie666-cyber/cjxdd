/**
 * Normal Flow evidence gate — verify 阶段的「真实可用」契约。
 *
 * xdd 的 `extensions/xdd/evidence/verify-gate.ts` 已包含完整 evidence 引用校验、
 * 类别检测、UI 证据、业务端点检测；该模块是 normal-flow 的等价物（paths 走
 * `normal_run/` 而不是 `xdd_run/`，并额外强制 happy-path / fallback /
 * wandering 三类证据 + RXX/Scenario/Plan 追溯闭合）。
 *
 * 「真实可用契约」由 9 道硬 gate 组成，和 xdd `evaluateVerifyEvidenceGateFull`
 * 对齐：
 *  1. RUN_DIR_MISSING                缺 `.xdd/runs/normal_run/`
 *  2. REPORT_MISSING / REPORT_TOO_SHORT 缺 verify-report.md 或不足 300 字符
 *  3. PLAN_UNFINISHED                当前 run plan checkbox 有 [ ] 未完成
 *  4. EVIDENCE_MISSING               verify-report 引用了不存在 / 越界的 evidence 文件
 *  5. EVIDENCE_FROM_OTHER_RUN        evidence 引用来自 xdd_run（跨 run 隔离）
 *  6. EVIDENCE_INSUFFICIENT          <2 类别证据
 *  7. UI_EVIDENCE_MISSING            有 wire 产物但 verify-report 无 UI 关键词
 *  8. BUSINESS_ENDPOINT_UNTESTED     只跳 /healthz 没业务端点
 *  9. HEALTH_CHECK_MISSING           缺 health-check.txt 或状态码非 2xx
 * 10. FALLBACK_EVIDENCE_MISSING      无 4xx/5xx 且无拒绝/无权等关键词
 * 11. WANDER_REPORT_MISSING          缺 wander-report.md 或 <3 步
 * 12. WANDER_FEATURE_UNMAPPED        wander 引用 .feature 但 verify 未对照
 * 13. VERIFY_MUTATED_CONTRACT        verify 阶段偷偷改了源码/设计文件
 * 14. TRACE_GAP                      spec RXX 与代码 @implements 追溯链未闭合
 * 15. FEATURE_SCENARIO_GAP           Feature Scenario 未在 plan 指明实现 + 验收测试
 * 16. RXX_UNTESTED                   verify-report 未逐 RXX 举证（防「全部通过」空洞）
 * 17. WANDERING_NOT_WALKED           plan 选了漫游场景但 wander-report 未走
 *
 * 这 17 道 gate 一起保证：「连用都用不了」的产品不能通过 verify。逻辑路径走
 * `normal_run/` 而不是 xdd 的 `xdd_run/`；trace / mutation / scenario 几道可
 * 直接复用 xdd 的实现（只需要把 paths 从 xdd_run 换到 normal_run）。
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { XddGateResult } from "../../xdd/types.ts";
import {
	detectEvidenceCategories,
	extractEvidenceReferences,
	hasUnfinishedPlanCheckbox,
} from "../../xdd/evidence/report-parser.ts";
import { NORMAL_FLOW_RUN_DIR } from "../../xdd/init-scaffold.ts";
import {
	diffVerifySnapshot,
	formatVerifySnapshotDiff,
} from "../../xdd/policy/verify-snapshot.ts";
import { buildTraceCoverage, observeFilesystem } from "../../xdd/observe-fs.ts";

export type NormalFlowEvidenceFailureCode =
	| "RUN_DIR_MISSING"
	| "REPORT_MISSING"
	| "REPORT_TOO_SHORT"
	| "PLAN_UNFINISHED"
	| "EVIDENCE_MISSING"
	| "EVIDENCE_INSUFFICIENT"
	| "UI_EVIDENCE_MISSING"
	| "BUSINESS_ENDPOINT_UNTESTED"
	| "HEALTH_CHECK_MISSING"
	| "FALLBACK_EVIDENCE_MISSING"
	| "WANDER_REPORT_MISSING"
	| "WANDER_FEATURE_UNMAPPED"
	| "EVIDENCE_FROM_OTHER_RUN"
	| "VERIFY_MUTATED_CONTRACT"
	| "TRACE_GAP"
	| "FEATURE_SCENARIO_GAP"
	| "SCENARIO_NOT_IMPLEMENTED"
	| "SCENARIO_UNVERIFIED"
	| "RXX_UNTESTED"
	| "WANDERING_NOT_WALKED";

export interface NormalFlowEvidenceFailure {
	code: NormalFlowEvidenceFailureCode;
	message: string;
	files: string[];
	remediation: string;
}

export interface NormalFlowEvidenceGateResult extends XddGateResult {
	failure?: NormalFlowEvidenceFailure;
}

export function evidenceFailureToGateResult(failure: NormalFlowEvidenceFailure): NormalFlowEvidenceGateResult {
	return { ok: false, reason: `${failure.code}: ${failure.message}\n修复: ${failure.remediation}`, failure };
}

export const EVIDENCE_RUN_DIR = NORMAL_FLOW_RUN_DIR;
export const EVIDENCE_DIR = `.xdd/runs/${EVIDENCE_RUN_DIR}/evidence`;
export const REPORT_PATH = `.xdd/runs/${EVIDENCE_RUN_DIR}/verify-report.md`;
export const WANDER_REPORT_PATH = `.xdd/runs/${EVIDENCE_RUN_DIR}/evidence/wander-report.md`;
export const HEALTH_CHECK_PATH = `${EVIDENCE_DIR}/health-check.txt`;

/** normal-flow 的 verify Gate。把 xdd 的 evidence gate 等价逻辑搬到 normal_run 路径。 */
export function evaluateNormalFlowVerifyGate(cwd: string): NormalFlowEvidenceGateResult {
	const runDirRel = EVIDENCE_RUN_DIR;
	const runDirAbs = join(cwd, ".xdd", "runs", runDirRel);
	if (!existsSync(runDirAbs) || !statSync(runDirAbs).isDirectory()) {
		return fail("RUN_DIR_MISSING", "verify Gate: 无法解析当前 normal-flow run 目录", [".xdd/runs/normal_run"], "创建 .xdd/runs/normal_run 目录，把本轮 plan/report/evidence 写入该目录。");
	}
	const reportRel = REPORT_PATH;
	const reportAbs = join(cwd, reportRel);
	if (!existsSync(reportAbs)) return fail("REPORT_MISSING", "verify Gate: 缺少当前 run 的 verify-report.md", [reportRel], "在当前 normal-run 写入 verify-report.md，不能复用其它 run 报告。");
	const report = readFileSync(reportAbs, "utf8");
	if (report.trim().length < 300) return fail("REPORT_TOO_SHORT", "verify Gate: verify-report.md 正文过短，缺少真实验证说明", [reportRel], "补充真实命令、接口/UI/边界证据与结果，正文至少 300 字符。");

	const unfinished = unfinishedPlanFiles(runDirAbs, cwd);
	if (unfinished.length > 0) return fail("PLAN_UNFINISHED", "verify Gate: 当前 run 仍有未完成 plan checkbox", unfinished, "完成或明确移除当前 run plan.md 中的 - [ ] 项，代码块示例不计。");

	const evidenceFailure = validateEvidenceRefs(cwd, runDirRel, report);
	if (evidenceFailure) return evidenceFailure;

	const categories = detectEvidenceCategories(report);
	if (categories.length < 2) return fail("EVIDENCE_INSUFFICIENT", "verify Gate: 报告至少需要覆盖两类证据", [reportRel], "至少覆盖 runtime/http/ui/db/auth/boundary/chaos/stub 中两类，并引用 evidence 文件。");

	if (hasWireArtifacts(cwd) && !categories.includes("ui")) {
		return fail("UI_EVIDENCE_MISSING", "verify Gate: 存在 wire 产物但缺少 UI evidence", [reportRel, ".xdd/design/wire"], "补充截图、DOM/可访问性快照或 HTML 响应证据。");
	}
	if (mentionsOnlyHealthEndpoint(report)) {
		return fail("BUSINESS_ENDPOINT_UNTESTED", "verify Gate: 只验证了 health 端点，缺少真实业务端点调用", [reportRel], "补充至少一个非 /health 或 /healthz 的公开业务端点调用证据。");
	}

	// 三件证据：health-check + fallback + wander-report。任意一件缺失即拒绝。
	const healthCheck = requireHealthCheckEvidence(cwd);
	if (!healthCheck.ok) return healthCheck;
	const fallback = requireFallbackEvidence(cwd, report);
	if (!fallback.ok) return fallback;
	const wander = requireWanderReport(cwd, report);
	if (!wander.ok) return wander;

	return { ok: true };
}

/**
 * 「全量」 verify gate（对齐 xdd `evaluateVerifyEvidenceGateFull`）——
 * `evaluateNormalFlowVerifyGate`（= xdd 的 `evaluateVerifyEvidenceGate`）
 * 只负责「存在性 + 引用合规」，而本函数负责「追溯闭合 + 退改护栏」。
 *
 * 缺一个 fail 都不放过：
 *  - VERIFY_MUTATED_CONTRACT   verify 阶段偷偷改了源码/设计契约
 *  - TRACE_GAP                 spec RXX 与 @implements 追溯链未闭
 *  - FEATURE_SCENARIO_GAP      Feature Scenario 未在 plan 中指明实现 + 验收测试
 *  - SCENARIO_NOT_IMPLEMENTED  plan 的 Implementation: 路径在磁盘上不存在
 *  - RXX_UNTESTED              verify-report 未逐 RXX 举证（防「全部通过」空洞）
 *  - SCENARIO_UNVERIFIED       verify-report 未逐 Scenario 举证 + 引用证据
 *  - WANDERING_NOT_WALKED      plan 选了漫游场景但 wander-report 未走
 *
 * stages.ts 的 verifyGate 必须调这个函数才能保持「约束效果跟 xdd 一样」。
 */
export function evaluateNormalFlowVerifyGateFull(cwd: string): NormalFlowEvidenceGateResult {
	const base = evaluateNormalFlowVerifyGate(cwd);
	if (!base.ok) return base;

	const mutation = evaluateNormalFlowVerifyMutation(cwd);
	if (!mutation.ok) return mutation;

	const trace = evaluateNormalFlowTraceCoverage(cwd);
	if (!trace.ok) return trace;

	const scenarios = evaluateNormalFlowFeatureScenarioCoverage(cwd);
	if (!scenarios.ok) return scenarios;

	const implemented = requireScenarioImplemented(cwd);
	if (!implemented.ok) return implemented;

	const perRxx = requirePerRxxVerification(cwd);
	if (!perRxx.ok) return perRxx;

	const perScenario = requirePerScenarioVerification(cwd);
	if (!perScenario.ok) return perScenario;

	const wandering = requireWanderingScenariosWalked(cwd);
	if (!wandering.ok) return wandering;

	return { ok: true };
}

// ── 全量 gate 增量函数 ──────────────────────────────────────────────────

export function evaluateNormalFlowVerifyMutation(cwd: string): NormalFlowEvidenceGateResult {
	const diff = diffVerifySnapshot(cwd);
	const files = [...diff.changed, ...diff.added, ...diff.deleted];
	if (files.length === 0) return { ok: true };
	return fail(
		"VERIFY_MUTATED_CONTRACT",
		"verify Gate: verify 阶段修改了源码或设计契约文件",
		files,
		`回滚到 execute 或对应设计阶段修复；verify 只允许写当前 run 的 report/evidence。变更: ${formatVerifySnapshotDiff(diff)}`,
	);
}

export function evaluateNormalFlowTraceCoverage(cwd: string): NormalFlowEvidenceGateResult {
	const coverage = buildTraceCoverage(observeFilesystem(cwd, []));
	if (coverage.specRxx.length === 0) return { ok: true, soft: true };
	if (coverage.unimplemented.length === 0 && coverage.orphan.length === 0) return { ok: true };
	const details = [
		coverage.unimplemented.length > 0 ? `未实现: ${coverage.unimplemented.join(", ")}` : "",
		coverage.orphan.length > 0 ? `孤儿标注: ${coverage.orphan.join(", ")}` : "",
	].filter(Boolean).join("；");
	return fail(
		"TRACE_GAP",
		`verify Gate: spec RXX 与代码 @implements 追溯链不闭合（${details}）`,
		[".xdd/design/spec", "src", "lib", "app"],
		"为每条 spec RXX 添加真实实现和 @implements RXX 标注，并移除或修正没有对应 spec 的孤儿 @implements。",
	);
}

export interface FeatureScenario {
	featurePath: string; // relative to spec root, e.g. "b01/auth.feature"
	keyword: string; // "Scenario" or "Scenario Outline"
	name: string; // scenario name
}

/** 从 .xdd/design/spec/ 下所有 .feature 收集 Scenario/Scenario Outline。 */
export function collectFeatureScenarios(cwd: string): FeatureScenario[] {
	const specRoot = join(cwd, ".xdd", "design", "spec");
	if (!existsSync(specRoot)) return [];
	return walk(specRoot)
		.filter((file) => file.endsWith(".feature"))
		.flatMap((file) => {
			const featurePath = relative(specRoot, file).replaceAll("\\", "/");
			return [...readFileSync(file, "utf8").matchAll(/^\s*(Scenario(?: Outline)?):\s*(.+?)\s*$/gm)]
				.map((match) => ({ featurePath, keyword: match[1], name: match[2] }));
		});
}

/** 在 plan task block 列表中查找匹配 scenario 的 Feature: 行所在块。 */
function findScenarioTaskBlock(taskBlocks: string[], scenario: FeatureScenario): string | null {
	return taskBlocks.find((block) => {
		const featureLine = block.match(/^\*\*Feature:\*\*\s*`?([^`\n]+)`?\s*$/m)?.[1]?.trim();
		if (!featureLine) return false;
		const expected = `${scenario.featurePath} :: ${scenario.keyword}: ${scenario.name}`;
		const basenameExpected = `${scenario.featurePath.split("/").at(-1)} :: ${scenario.keyword}: ${scenario.name}`;
		return featureLine === expected || featureLine === basenameExpected;
	}) ?? null;
}

export function evaluateNormalFlowFeatureScenarioCoverage(cwd: string): NormalFlowEvidenceGateResult {
	const scenarios = collectFeatureScenarios(cwd);
	if (scenarios.length === 0) return { ok: true, soft: true };

	const runDir = EVIDENCE_RUN_DIR;
	const planFiles = walk(join(cwd, ".xdd", "runs", runDir)).filter((file) => file.endsWith("plan.md"));
	const taskBlocks = planFiles.flatMap((file) => readFileSync(file, "utf8").split(/^###\s+Task\b/gm).slice(1));

	const missing = scenarios.filter((scenario) => {
		const block = findScenarioTaskBlock(taskBlocks, scenario);
		if (!block) return true;
		return !/^\*\*Implementation:\*\*\s*`?\S.+$/m.test(block) || !/^\*\*Acceptance Test:\*\*\s*`?\S.+$/m.test(block);
	});
	if (missing.length === 0) return { ok: true };
	const labels = missing.map((scenario) => `${scenario.featurePath} :: ${scenario.keyword}: ${scenario.name}`);
	return fail(
		"FEATURE_SCENARIO_GAP",
		`verify Gate: ${missing.length} 个 Feature Scenario 未指明可实现闭环（${labels.join("；")}）`,
		[".xdd/design/spec/**/*.feature", `.xdd/runs/${runDir}/plan/**/plan.md`],
		"为每个 Scenario/Scenario Outline 建立精确 **Feature:** 锚，并在同一 Task 填写生产代码 **Implementation:** 与可运行 **Acceptance Test:**；不得只映射 RXX。",
	);
}

/**
 * 每个 Scenario 的 plan **Implementation:** 路径必须在磁盘上真实存在。
 * 防止「plan 写了 src/auth.ts 但根本没写代码」的 sham。只检查看起来像文件路径的值
 * （含 / 或 . 且无空格），跳过描述性文本。
 */
function requireScenarioImplemented(cwd: string): NormalFlowEvidenceGateResult {
	const scenarios = collectFeatureScenarios(cwd);
	if (scenarios.length === 0) return { ok: true, soft: true };

	const runDir = EVIDENCE_RUN_DIR;
	const planFiles = walk(join(cwd, ".xdd", "runs", runDir)).filter((file) => file.endsWith("plan.md"));
	const taskBlocks = planFiles.flatMap((file) => readFileSync(file, "utf8").split(/^###\s+Task\b/gm).slice(1));

	const notImplemented: Array<{ scenario: FeatureScenario; implPath: string }> = [];
	for (const scenario of scenarios) {
		const block = findScenarioTaskBlock(taskBlocks, scenario);
		if (!block) continue; // 已被 FEATURE_SCENARIO_GAP 捕获
		const implPath = block.match(/^\*\*Implementation:\*\*\s*`?([^`\n]+)`?\s*$/m)?.[1]?.trim();
		if (!implPath || !looksLikeFilePath(implPath)) continue;
		if (!existsSync(join(cwd, implPath))) {
			notImplemented.push({ scenario, implPath });
		}
	}
	if (notImplemented.length === 0) return { ok: true };
	const labels = notImplemented.map(({ scenario, implPath }) =>
		`${scenario.featurePath} :: ${scenario.keyword}: ${scenario.name} (Implementation: ${implPath} 不存在)`);
	return fail(
		"SCENARIO_NOT_IMPLEMENTED",
		`verify Gate: ${notImplemented.length} 个 Scenario 的 Implementation 路径在磁盘上不存在（${labels.join("；")}）`,
		[`.xdd/runs/${runDir}/plan.md`, "src", "lib", "app"],
		"回到 execute 阶段把每个 Scenario 的实现代码真正写出来，或修正 plan.md 的 **Implementation:** 路径指向真实存在的源文件。",
	);
}

/**
 * 逐 Scenario 举证验证 -- 每个 .feature Scenario 必须在 verify-report.md 有独立块 + Verdict + Evidence。
 * 比 RXX_UNTESTED 更细：一条 RXX 可能有多个 Scenario，每个都要单独验证。
 *
 * 约定格式（verify-report.md 需逐条出现）：
 *   ### Scenario: <Scenario 名>
 *   - Feature: <feature 文件名>
 *   - Verdict: PASS | FAIL | N/A
 *   - Evidence: <evidence 文件路径>  (PASS/FAIL/PASS_WITH_FRICTION 必须引用)
 */
function requirePerScenarioVerification(cwd: string): NormalFlowEvidenceGateResult {
	const scenarios = collectFeatureScenarios(cwd);
	if (scenarios.length === 0) return { ok: true, soft: true };

	const reportAbs = join(cwd, REPORT_PATH);
	if (!existsSync(reportAbs)) return { ok: true, soft: true };
	const report = readFileSync(reportAbs, "utf8");

	const missing: string[] = [];
	const vagueVerdicts: string[] = [];
	const noEvidence: string[] = [];

	for (const scenario of scenarios) {
		const label = `${scenario.featurePath} :: ${scenario.keyword}: ${scenario.name}`;
		const block = extractScenarioBlock(report, scenario);
		if (!block) { missing.push(label); continue; }
		const verdict = extractRxxVerdict(block);
		if (!verdict || !isValidVerdict(verdict)) { vagueVerdicts.push(label); continue; }
		// PASS / FAIL / PASS_WITH_FRICTION 必须引用真实证据
		if (/^(PASS|FAIL|PASS_WITH_FRICTION)$/i.test(verdict)) {
			const evidence = extractScenarioEvidence(block);
			if (!evidence || !evidence.trim() || /^N\/A/i.test(evidence.trim())) {
				noEvidence.push(label);
			}
		}
	}
	if (missing.length === 0 && vagueVerdicts.length === 0 && noEvidence.length === 0) return { ok: true };
	const parts: string[] = [];
	if (missing.length > 0) parts.push(`未独立验证: ${missing.join(", ")}`);
	if (vagueVerdicts.length > 0) parts.push(`Verdict 表述不明: ${vagueVerdicts.join(", ")}`);
	if (noEvidence.length > 0) parts.push(`缺 Evidence 引用: ${noEvidence.join(", ")}`);
	return fail(
		"SCENARIO_UNVERIFIED",
		`verify Gate: ${missing.length + vagueVerdicts.length + noEvidence.length} 个 Feature Scenario 未被真实验证（${parts.join("；")}）`,
		[REPORT_PATH, ".xdd/design/spec/**/*.feature"],
		"为每个 Scenario 在 verify-report.md 写 ### Scenario: 块，含 Verdict: PASS|FAIL|N/A 和 Evidence: <路径>（PASS/FAIL 必须引用真实证据文件）。不得用「全部通过」空洞表述。",
	);
}

/**
 * 逐 RXX 举证验证 —— 防止「全部通过」「已验证」这类空洞表述蒙混过关。
 *
 * 约定格式（verify-report.md 需逐条出现）：
 *   ### RXX: <规则名>
 *   - Verdict: PASS | FAIL | N/A
 *   - Evidence: <evidence 文件路径> | N/A: <原因>
 *
 * 每条 spec RXX 在 verify-report.md 必须独立出现；不能只写「全部 PASS」。
 * 「Verdict」必须明确写明结果，不能是「已验证」这种抽象表述。
 */
function requirePerRxxVerification(cwd: string): NormalFlowEvidenceGateResult {
	const specRoot = join(cwd, ".xdd", "design", "spec");
	if (!existsSync(specRoot)) return { ok: true, soft: true };
	const rxxIds = collectSpecRxxIds(specRoot);
	if (rxxIds.length === 0) return { ok: true, soft: true };

	const reportAbs = join(cwd, REPORT_PATH);
	if (!existsSync(reportAbs)) return { ok: true, soft: true };
	const report = readFileSync(reportAbs, "utf8");

	const missing: string[] = [];
	const vagueVerdicts: string[] = [];
	for (const id of rxxIds) {
		const block = extractRxxBlock(report, id);
		if (!block) { missing.push(id); continue; }
		const verdict = extractRxxVerdict(block);
		if (!verdict) { vagueVerdicts.push(id); continue; }
		if (!isValidVerdict(verdict)) vagueVerdicts.push(id);
	}
	if (missing.length === 0 && vagueVerdicts.length === 0) return { ok: true };
	const parts: string[] = [];
	if (missing.length > 0) parts.push(`未独立举证: ${missing.join(", ")}`);
	if (vagueVerdicts.length > 0) parts.push(`Verdict 表述不明: ${vagueVerdicts.join(", ")}`);
	return fail(
		"RXX_UNTESTED",
		`verify Gate: verify-report.md 未逐 RXX 举证（${parts.join("；")}）`,
		[REPORT_PATH, ".xdd/design/spec/**/rules.md"],
		"为每条 RXX 在 verify-report.md 写 ### RXX: 块并明确 Verdict: PASS|FAIL|N/A，不得用「全部通过」/「已验证」空洞表述蒙混。",
	);
}

/**
 * Plan 中声明的漫游场景必须真的在 wander-report.md 里被走到。
 *
 * 约定格式（plan.md 需挑出漫游场景）：
 *   ## Wandering Scenario
 *   - Feature: <.feature 路径>
 *   - Scenario: <Scenario 名>
 *
 * 然后 wander-report.md 必须包含该 Scenario 名（任一出现即可）。
 */
function requireWanderingScenariosWalked(cwd: string): NormalFlowEvidenceGateResult {
	const planAbs = join(cwd, ".xdd", "runs", EVIDENCE_RUN_DIR, "plan.md");
	const wanderAbs = join(cwd, WANDER_REPORT_PATH);
	if (!existsSync(planAbs) || !existsSync(wanderAbs)) return { ok: true, soft: true };

	const planText = readFileSync(planAbs, "utf8");
	const declared = extractDeclaredWanderingScenarios(planText);
	if (declared.length === 0) return { ok: true, soft: true };

	const wanderText = readFileSync(wanderAbs, "utf8");
	const unwalked = declared.filter(({ feature, scenario }) => {
		// wander-report.md 必须包含该 .feature 基名 + Scenario 名 才能认作走过。
		const featureBase = feature.split("/").pop() ?? feature;
		const inFeature = wanderText.includes(featureBase) || wanderText.includes(feature);
		const inScenario = scenario && wanderText.includes(scenario);
		return !(inFeature && inScenario);
	});
	if (unwalked.length === 0) return { ok: true };
	const labels = unwalked.map((d) => `${d.feature} :: ${d.scenario}`);
	return fail(
		"WANDERING_NOT_WALKED",
		`verify Gate: plan 声明了 ${declared.length} 个漫游场景但 wander-report 未走（${labels.join("；")}）`,
		[planAbs, WANDER_REPORT_PATH],
		"用 nf_wander record_step 把 plan 中声明的每个漫游场景实际走一遍，并在 wander-report.md 引用同一 .feature + Scenario 名。",
	);
}

// ── RXX / wandering 追溯辅助 ──────────────────────────────────────────────────

/** 从 spec/<bxx>/rules.md 收集所有 RXX id（含 B##-R## 形式）。空文件跳过。 */
function collectSpecRxxIds(specRoot: string): string[] {
	const ids = new Set<string>();
	for (const file of walk(specRoot)) {
		if (!file.endsWith("rules.md")) continue;
		const text = readFileSync(file, "utf8");
		for (const match of text.matchAll(/\b(B\d{2}-)?R\d{2}\b/g)) {
			ids.add(match[0]);
		}
	}
	return [...ids];
}

/** 抓 verify-report.md 里 `### RXX:` 块的整段文本（包含下属行）。 */
function extractRxxBlock(report: string, rxxId: string): string | null {
	// 匹配 ### R## / ### B##-R## / ### R##: <name>，到下一个 ### 开头为止。
	const re = new RegExp(`###\\s+(${rxxId.replace("-", "\\-")})\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n###\\s+|\\n##\\s+|$)`, "i");
	const m = report.match(re);
	return m?.[2] ?? null;
}

/** 抓 RXX 块里的 `Verdict:` 行；不区分大小写，匹配第一个。 */
function extractRxxVerdict(block: string): string | null {
	const m = block.match(/^\s*[-*]?\s*Verdict\s*[::]\s*([^\n]+)/im);
	return m?.[1]?.trim() ?? null;
}

function isValidVerdict(verdict: string): boolean {
	return /^(PASS|PASS_WITH_FRICTION|FAIL|BLOCKED|INCONCLUSIVE|N\/A)$/i.test(verdict.trim());
}

/** 从 verify-report.md 提取匹配 scenario 的 ### Scenario: 块。优先匹配 header 同时含
 *  feature 文件名 + Scenario 名；回退到仅含 Scenario 名。 */
function extractScenarioBlock(report: string, scenario: FeatureScenario): string | null {
	const featureBase = scenario.featurePath.split("/").at(-1)!;
	const blocks = report.match(/###\s+Scenario:[^\n]*\n[\s\S]*?(?=\n###\s+|\n##\s+|$)/gi) ?? [];
	for (const block of blocks) {
		const header = block.split("\n")[0];
		if (header.includes(featureBase) && header.includes(scenario.name)) return block;
	}
	for (const block of blocks) {
		const header = block.split("\n")[0];
		if (header.includes(scenario.name)) return block;
	}
	return null;
}

/** 从 Scenario 块提取 Evidence: 行。 */
function extractScenarioEvidence(block: string): string | null {
	const m = block.match(/^\s*[-*]?\s*Evidence\s*:\s*([^\n]+)/im);
	return m?.[1]?.trim() ?? null;
}

/** 判断字符串是否像文件路径（用于 Implementation: 存在性检查）。 */
function looksLikeFilePath(s: string): boolean {
	return !/\s/.test(s) && !/^https?:\/\//.test(s) && /[/.]/.test(s);
}

/** 从 plan.md 抓 `## Wandering Scenario` 块里声明的 (feature, scenario) 对。 */
function extractDeclaredWanderingScenarios(planText: string): Array<{ feature: string; scenario: string }> {
	const out: Array<{ feature: string; scenario: string }> = [];
	const re = /##\s+Wandering\s+Scenarios?\b[\s\S]*?(?=\n##\s+|$)/gi;
	let block: RegExpExecArray | null;
	while ((block = re.exec(planText)) !== null) {
		const lines = block[0].split("\n");
		let feature = "";
		let scenario = "";
		for (const line of lines) {
			const fm = line.match(/^\s*[-*]?\s*Feature\s*:\s*(\S+)/i);
			if (fm) feature = fm[1].trim();
			const sm = line.match(/^\s*[-*]?\s*Scenario\s*:\s*(.+)/i);
			if (sm) scenario = sm[1].trim();
		}
		if (feature) out.push({ feature, scenario });
	}
	return out;
}

// ── 内部 helper ─────────────────────────────────────────────────────────────

function requireHealthCheckEvidence(cwd: string): NormalFlowEvidenceGateResult {
	const path = join(cwd, HEALTH_CHECK_PATH);
	if (!existsSync(path)) {
		return fail(
			"HEALTH_CHECK_MISSING",
			"verify Gate: 缺少健康检查证据（无法证明服务真能起）",
			[HEALTH_CHECK_PATH],
			"启动服务，curl 健康端点（如 /healthz），把状态码和响应体写入 .xdd/runs/normal_run/evidence/health-check.txt；可跑 scripts/nf-wander.sh 一键生成。",
		);
	}
	const content = readFileSync(path, "utf8");
	if (!/(?:^|\s)(?:200|2\d\d|ok|OK|healthy)\b/.test(content)) {
		return fail(
			"HEALTH_CHECK_MISSING",
			"verify Gate: health-check.txt 内容不包含成功状态码（200/2xx/ok）",
			[HEALTH_CHECK_PATH],
			"用 curl 跑通健康检查，把状态码 + 响应体写入 health-check.txt。",
		);
	}
	return { ok: true };
}

function requireFallbackEvidence(cwd: string, report: string): NormalFlowEvidenceGateResult {
	// 兜底证据有两种合法形式：
	//  (a) evidence/responses/ 下有文件名含 4xx/5xx 的 curl 响应体；
	//  (b) verify-report.md 显式记录 ≥1 条负面场景（401/403/404/422/500 关键词）。
	const responsesDir = join(cwd, EVIDENCE_DIR, "responses");
	let hasFallbackResponse = false;
	try {
		if (existsSync(responsesDir)) {
			for (const file of readdirSync(responsesDir)) {
				const abs = join(responsesDir, file);
				if (!statSync(abs).isFile()) continue;
				const text = readFileSync(abs, "utf8");
				if (/\b(4\d\d|5\d\d)\b/.test(text)) { hasFallbackResponse = true; break; }
			}
		}
	} catch { /* missing dir handled by try */ }
	const reportHasFallback = /(401|403|404|422|500|unauthori[sz]ed|forbidden|not\s*found|conflict|拒绝|无权|未找到|无权限|失败|超限|异常)/i.test(report);
	if (!hasFallbackResponse && !reportHasFallback) {
		return fail(
			"FALLBACK_EVIDENCE_MISSING",
			"verify Gate: 缺少负面/兜底场景证据（4xx/5xx 响应或拒绝/失败/无权等关键词）",
			[EVIDENCE_DIR, REPORT_PATH],
			"至少做 1 次失败路径验证：未登录访问保护端点（401/403）、不存在资源（404）、非法输入（422）、依赖宕机（500），把响应体或关键词写入证据。",
		);
	}
	return { ok: true };
}

function requireWanderReport(cwd: string, report: string): NormalFlowEvidenceGateResult {
	const wanderAbs = join(cwd, WANDER_REPORT_PATH);
	if (!existsSync(wanderAbs)) {
		return fail(
			"WANDER_REPORT_MISSING",
			"verify Gate: 缺少用户漫游证据（无法证明真实用户能从入口跑通核心 Feature）",
			[WANDER_REPORT_PATH],
			"用 nf_wander 工具或 scripts/nf-wander.sh 至少记录 1 条 Feature Scenario 的真实步骤（命令→观察→结果→截图/响应路径）。",
		);
	}
	const text = readFileSync(wanderAbs, "utf8");
	const stepCount = (text.match(/^\s*(?:##\s*Step|###\s*Step|\d+)\.\s+/gim) ?? []).length
		+ (text.match(/^\s*-\s+(?:操作|观察|step)/gim) ?? []).length;
	if (stepCount < 3) {
		return fail(
			"WANDER_REPORT_MISSING",
			"verify Gate: wander-report.md 步骤数过少（<3），无法证明完整漫游",
			[WANDER_REPORT_PATH],
			"用 nf_wander record_step 至少记录 3 步（操作→观察→结果），覆盖从入口到目标的核心 Feature 路径。",
		);
	}
	// 必须引用至少 1 条 spec Feature，否则漫游和需求脱钩。
	const featureRel = extractWanderedFeature(text);
	if (featureRel && !report.includes(featureRel.split("/").pop()!)) {
		return fail(
			"WANDER_FEATURE_UNMAPPED",
			"verify Gate: wander-report.md 引用了 .feature 但 verify-report.md 未对照同一场景",
			[REPORT_PATH, WANDER_REPORT_PATH],
			"在 verify-report.md 引用相同 Feature Scenario 名，让 wander 和 verify 报告互相锚定。",
		);
	}
	return { ok: true };
}

function extractWanderedFeature(text: string): string | null {
	const m = text.match(/\.xdd\/design\/spec\/[^\s)`"']+\.feature/g);
	return m?.[0] ?? null;
}

function unfinishedPlanFiles(activeRunDir: string, cwd: string): string[] {
	const planFiles = walk(activeRunDir).filter((file) => file.endsWith("plan.md"));
	return planFiles.filter((file) => hasUnfinishedPlanCheckbox(readFileSync(file, "utf8"))).map((file) => relative(cwd, file));
}

function validateEvidenceRefs(cwd: string, runDir: string, report: string): NormalFlowEvidenceGateResult | null {
	const refs = extractEvidenceReferences(report);
	if (refs.length === 0) return fail("EVIDENCE_MISSING", "verify Gate: verify-report.md 未引用当前 run evidence 文件", [`.xdd/runs/${runDir}/evidence`], "把命令输出、HTTP 响应、截图/DOM 等证据写入 evidence 目录，并在报告中引用路径。");
	const evidenceRoot = realpathOrResolve(join(cwd, ".xdd", "runs", runDir, "evidence"));
	const missing: string[] = [];
	const fromOtherRun: string[] = [];
	for (const ref of refs) {
		if (!ref.startsWith(`.xdd/runs/${runDir}/evidence/`)) {
			// 引用指向了别的 run（很可能是 xdd_run）—— 这是 NF 的硬错误，避免和 xdd run 互相污染。
			if (/^\.xdd\/runs\//.test(ref)) fromOtherRun.push(ref);
			else missing.push(ref);
			continue;
		}
		const abs = resolve(cwd, ref);
		if (!existsSync(abs)) { missing.push(ref); continue; }
		const real = realpathOrResolve(abs);
		if (relative(evidenceRoot, real).startsWith("..")) missing.push(ref);
	}
	if (fromOtherRun.length > 0) {
		return fail(
			"EVIDENCE_FROM_OTHER_RUN",
			"verify Gate: verify-report.md 引用了非 normal-flow run 的 evidence 路径",
			fromOtherRun,
			"只引用 .xdd/runs/normal_run/evidence/ 下的真实证据；不要混用 xdd_run 或其它 run 的 evidence。",
		);
	}
	if (missing.length > 0) return fail("EVIDENCE_MISSING", "verify Gate: evidence 引用缺失、逃逸或来自其它 run", missing, "仅引用当前 normal-run evidence 目录中真实存在的文件。");
	return null;
}

function hasWireArtifacts(cwd: string): boolean {
	const dir = join(cwd, ".xdd", "design", "wire");
	return existsSync(dir) && walk(dir).some((file) => file.endsWith(".md") && statSync(file).size > 0);
}

function mentionsOnlyHealthEndpoint(report: string): boolean {
	const endpoints = [...report.matchAll(/\b(?:GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s`)]*)/gi)].map((match) => match[1].replace(/[.,;:]+$/, ""));
	return endpoints.length > 0 && endpoints.every((endpoint) => endpoint === "/health" || endpoint === "/healthz");
}

function walk(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop()!;
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else out.push(full);
		}
	}
	return out;
}

function realpathOrResolve(path: string): string {
	try { return realpathSync(path); } catch { return resolve(path); }
}

function fail(code: NormalFlowEvidenceFailureCode, message: string, files: string[], remediation: string): NormalFlowEvidenceGateResult {
	return evidenceFailureToGateResult({ code, message, files, remediation });
}