import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { XDD_RUN_DIR } from "../init-scaffold.ts";
import type { XddGateResult } from "../types.ts";
import { readResults } from "../blind-journey.ts";
import { HarnessStore } from "../harness/store.ts";
import { buildTraceCoverage, observeFilesystem } from "../observe-fs.ts";
import { diffVerifySnapshot, formatVerifySnapshotDiff } from "../policy/verify-snapshot.ts";
import { detectEvidenceCategories, extractEvidenceReferences, hasUnfinishedPlanCheckbox } from "./report-parser.ts";
import { evaluateQaEvidenceGate } from "../qa-plan.ts";
import { createHash } from "node:crypto";
import { captureSubjectDigests } from "../healing/content-digest.ts";
import type { VerifyReceipt } from "../types.ts";
import { RuntimeStore } from "../storage/runtime-store.ts";
import { verifyReceiptMatches } from "../healing/healing-case.ts";
import { healingEnforced } from "../healing/mode.ts";

const execFileAsync = promisify(execFile);

export type EvidenceGateFailureCode =
	| "RUN_DIR_MISSING"
	| "REPORT_MISSING"
	| "REPORT_TOO_SHORT"
	| "PLAN_UNFINISHED"
	| "EVIDENCE_MISSING"
	| "EVIDENCE_INSUFFICIENT"
	| "UI_EVIDENCE_MISSING"
	| "BUSINESS_ENDPOINT_UNTESTED"
	| "VERIFY_COMMAND_FAILED"
	| "TRACE_GAP"
	| "FEATURE_SCENARIO_GAP"
	| "VERIFY_MUTATED_CONTRACT"
	| "BLIND_JOURNEY_FAILED"
	| "EVIDENCE_STALE_AFTER_ROLLBACK"
	| "EVIDENCE_SUBJECT_MISMATCH";

export interface EvidenceGateFailure {
	code: EvidenceGateFailureCode;
	message: string;
	files: string[];
	remediation: string;
}

export interface VerifyEvidenceGateResult extends XddGateResult {
	failure?: EvidenceGateFailure;
}

export function evidenceFailureToGateResult(failure: EvidenceGateFailure): VerifyEvidenceGateResult {
	return { ok: false, reason: `${failure.code}: ${failure.message}\n修复: ${failure.remediation}`, failure };
}

export function evaluateVerifyEvidenceGate(cwd: string): VerifyEvidenceGateResult {
	const runDir = currentRunDir(cwd);
	if (!runDir) return fail("RUN_DIR_MISSING", "verify Gate: 无法解析当前 xdd run 目录", [".xdd/runs/xdd_run"], "创建 .xdd/runs/xdd_run 并把本轮 plan/report/evidence 写入该目录。");
	const activeRunDir = join(cwd, ".xdd", "runs", runDir);
	const reportRel = `.xdd/runs/${runDir}/verify-report.md`;
	const reportAbs = join(cwd, reportRel);
	if (!existsSync(reportAbs)) return fail("REPORT_MISSING", "verify Gate: 缺少当前 run 的 verify-report.md", [reportRel], "在当前 run 写入 verify-report.md，不能复用其它 run 报告。");
	const report = readFileSync(reportAbs, "utf8");
	if (report.trim().length < 300) return fail("REPORT_TOO_SHORT", "verify Gate: verify-report.md 正文过短，缺少真实验证说明", [reportRel], "补充真实命令、接口/UI/边界证据与结果，正文至少 300 字符。");
	const unfinished = unfinishedPlanFiles(activeRunDir, cwd);
	if (unfinished.length > 0) return fail("PLAN_UNFINISHED", "verify Gate: 当前 run 仍有未完成 plan checkbox", unfinished, "完成或明确移除当前 run plan.md 中的 - [ ] 项，代码块示例不计。");
	const evidenceFailure = validateEvidenceRefs(cwd, runDir, report);
	if (evidenceFailure) return evidenceFailure;
	const categories = detectEvidenceCategories(report);
	if (categories.length < 2) return fail("EVIDENCE_INSUFFICIENT", "verify Gate: 报告至少需要覆盖两类证据", [reportRel], "至少覆盖 runtime/http/ui/db/auth/boundary/chaos/stub 中两类，并引用 evidence 文件。");
	if (hasWireArtifacts(cwd) && !categories.includes("ui")) {
		return fail("UI_EVIDENCE_MISSING", "verify Gate: 存在 wire 产物但缺少 UI evidence", [reportRel, ".xdd/design/wire"], "补充截图、DOM/可访问性快照或 HTML 响应证据。");
	}
	if (mentionsOnlyHealthEndpoint(report)) {
		return fail("BUSINESS_ENDPOINT_UNTESTED", "verify Gate: 只验证了 health 端点，缺少真实业务端点调用", [reportRel], "补充至少一个非 /health 或 /healthz 的公开业务端点调用证据。");
	}
	return { ok: true };
}

export async function evaluateVerifyEvidenceGateFull(cwd: string): Promise<VerifyEvidenceGateResult> {
	const base = evaluateVerifyEvidenceGate(cwd);
	if (!base.ok) return base;
	const runtime = new RuntimeStore(cwd).load();
	if (healingEnforced() && runtime?.activeHealingCaseId) {
		if (!runtime.lastVerifyReceipt) return fail("EVIDENCE_STALE_AFTER_ROLLBACK", "verify Gate: rollback 后缺少 Controller VerifyReceipt", [".xdd/runtime.json"], "重新调用 xdd_submit_artifact；Controller 会重跑 Harness 并生成当前 generation 回执。");
		const freshness = verifyReceiptMatches(cwd, runtime.lastVerifyReceipt, runtime.verifyGeneration, runtime.activeHealingCaseId);
		if (!freshness.ok) return fail(freshness.code as EvidenceGateFailureCode, `verify Gate: ${freshness.reason}`, [".xdd/runtime.json", ".xdd/harness.yml"], freshness.reason ?? "重新运行 Harness。");
	}
	const mutation = evaluateVerifyMutation(cwd);
	if (!mutation.ok) return mutation;
	const trace = evaluateTraceCoverage(cwd);
	if (!trace.ok) return trace;
	const scenarios = evaluateFeatureScenarioCoverage(cwd);
	if (!scenarios.ok) return scenarios;
	const qaEvidence = evaluateQaEvidenceGate(cwd);
	if (!qaEvidence.ok) return qaEvidence;
	const commands = await evaluateHarnessValidationCommands(cwd);
	if (!commands.ok) return commands;
	const blind = evaluateBlindJourneyFailure(cwd);
	if (!blind.ok) return blind;
	return { ok: true };
}

/** Re-run the exact mechanical predicate that opened a HealingCase. */
export async function evaluateHealingFailureClosure(cwd: string, code: string): Promise<VerifyEvidenceGateResult> {
	if (code === "TRACE_GAP") return evaluateTraceCoverage(cwd);
	if (code === "FEATURE_SCENARIO_GAP") return evaluateFeatureScenarioCoverage(cwd);
	if (code === "VERIFY_COMMAND_FAILED") return evaluateHarnessValidationCommands(cwd);
	if (code === "BLIND_JOURNEY_FAILED") return evaluateBlindJourneyFailure(cwd);
	// VERIFY_MUTATED_CONTRACT is closed by repairing in the owning stage and
	// capturing a new verify-entry snapshot; evaluating the old snapshot here
	// would incorrectly reject the intended repair itself.
	if (code === "VERIFY_MUTATED_CONTRACT") return { ok: true, soft: true };
	if (code === "PLAN_UNFINISHED") {
		const runDir = currentRunDir(cwd);
		if (!runDir) return fail("RUN_DIR_MISSING", "Healing Closure: 当前 run 目录缺失", [".xdd/runs/xdd_run"], "恢复当前 run plan 后重试。");
		const unfinished = unfinishedPlanFiles(join(cwd, ".xdd", "runs", runDir), cwd);
		return unfinished.length === 0 ? { ok: true } : fail("PLAN_UNFINISHED", "Healing Closure: plan 仍有未完成 checkbox", unfinished, "完成 plan checkbox 并保留 QA 契约。");
	}
	return { ok: true, soft: true };
}

export function evaluateVerifyMutation(cwd: string): VerifyEvidenceGateResult {
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

export function evaluateTraceCoverage(cwd: string): VerifyEvidenceGateResult {
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

/** Require every Gherkin Scenario to name both its production implementation and acceptance test in the active plan. */
export function evaluateFeatureScenarioCoverage(cwd: string): VerifyEvidenceGateResult {
	const specRoot = join(cwd, ".xdd", "design", "spec");
	const scenarios = walk(specRoot)
		.filter((file) => file.endsWith(".feature"))
		.flatMap((file) => {
			const featurePath = relative(specRoot, file).replaceAll("\\", "/");
			return [...readFileSync(file, "utf8").matchAll(/^\s*(Scenario(?: Outline)?):\s*(.+?)\s*$/gm)]
				.map((match) => ({ featurePath, keyword: match[1], name: match[2] }));
		});
	if (scenarios.length === 0) return { ok: true, soft: true };

	const runDir = currentRunDir(cwd);
	const planFiles = runDir ? walk(join(cwd, ".xdd", "runs", runDir)).filter((file) => file.endsWith("plan.md")) : [];
	const taskBlocks = planFiles.flatMap((file) => readFileSync(file, "utf8").split(/^###\s+Task\b/gm).slice(1));
	const missing = scenarios.filter((scenario) => !taskBlocks.some((block) => {
		const featureLine = block.match(/^\*\*Feature:\*\*\s*`?([^`\n]+)`?\s*$/m)?.[1]?.trim();
		if (!featureLine) return false;
		const expected = `${scenario.featurePath} :: ${scenario.keyword}: ${scenario.name}`;
		const basenameExpected = `${scenario.featurePath.split("/").at(-1)} :: ${scenario.keyword}: ${scenario.name}`;
		const mapped = featureLine === expected || featureLine === basenameExpected;
		return mapped && /^\*\*Implementation:\*\*\s*`?\S.+$/m.test(block) && /^\*\*Acceptance Test:\*\*\s*`?\S.+$/m.test(block);
	}));
	if (missing.length === 0) return { ok: true };
	const labels = missing.map((scenario) => `${scenario.featurePath} :: ${scenario.keyword}: ${scenario.name}`);
	return fail(
		"FEATURE_SCENARIO_GAP",
		`verify Gate: ${missing.length} 个 Feature Scenario 未指明可实现闭环（${labels.join("；")}）`,
		[".xdd/design/spec/**/*.feature", `.xdd/runs/${runDir ?? XDD_RUN_DIR}/plan/**/plan.md`],
		"为每个 Scenario/Scenario Outline 建立精确 **Feature:** 锚，并在同一 Task 填写生产代码 **Implementation:** 与可运行 **Acceptance Test:**；不得只映射 RXX。",
	);
}

export async function evaluateHarnessValidationCommands(cwd: string): Promise<VerifyEvidenceGateResult> {
	const store = new HarnessStore(cwd);
	const harnessCommands = store.load().验证命令;
	const commands = harnessCommands.length > 0 ? harnessCommands : discoverValidationCommands(cwd);
	if (commands.length === 0) {
		return fail("VERIFY_COMMAND_FAILED", "verify Gate: 未配置且未检测到可运行验证命令", [".xdd/harness.yml"], "用 xdd_harness_set 写入已确认的测试/构建命令，例如 npm test 或 npm run build。");
	}
	const failures: string[] = [];
	for (const command of commands) {
		const result = await runValidationCommand(cwd, command);
		if (!result.ok) failures.push(result.message);
		else if (harnessCommands.length === 0) store.update("验证命令", "append", command);
	}
	if (failures.length > 0) {
		return fail("VERIFY_COMMAND_FAILED", `verify Gate: ${failures.length} 条 Harness 验证命令失败`, [".xdd/harness.yml"], `${failures.join("\n")}\n修复失败命令或用 xdd_harness_set 更新验证命令。`);
	}
	return { ok: true };
}

/** Controller-owned execution receipt. Evidence prose is never a substitute for this result. */
export async function runHarnessWithReceipt(cwd: string, generation: number, healingCaseId?: string): Promise<VerifyReceipt> {
	const store = new HarnessStore(cwd);
	const configured = store.load().验证命令;
	const commands = configured.length > 0 ? configured : discoverValidationCommands(cwd);
	const receipts: VerifyReceipt["commands"] = [];
	for (const command of commands) {
		try {
			const result = await execFileAsync("bash", ["-lc", command], { cwd, timeout: 180000, maxBuffer: 1024 * 1024, env: { ...process.env, CI: "true" } });
			const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
			receipts.push({ command, exitCode: 0, outputDigest: `sha256:${createHash("sha256").update(output).digest("hex")}` });
		} catch (error) {
			const failed = error as { code?: number; stdout?: string | Buffer; stderr?: string | Buffer };
			const output = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
			receipts.push({ command, exitCode: typeof failed.code === "number" ? failed.code : 1, outputDigest: `sha256:${createHash("sha256").update(output).digest("hex")}` });
		}
	}
	return { generation, healingCaseId, capturedAt: new Date().toISOString(), ...captureSubjectDigests(cwd), commands: receipts };
}

export function evaluateBlindJourneyFailure(cwd: string): VerifyEvidenceGateResult {
	if (!blindJourneyRolesExist(cwd)) return { ok: true, soft: true };
	const results = readResults(cwd);
	if (results.length === 0) return fail("BLIND_JOURNEY_FAILED", "Blind Journey Gate: 已定义角色但无验收结果", [".xdd/runs"], "用 xdd_blind_journey 执行 Actor/Judge 两阶段并记录结果。");
	const blockers = results.filter((r) => r.verdict === "FAIL" || r.verdict === "BLOCKED" || r.verdict === "INCONCLUSIVE");
	const p0p1 = results.flatMap((r) => (r.issues ?? []).filter((i) => i.severity === "P0" || i.severity === "P1").map((i) => `${r.roleId}/${r.scenarioId} [${i.severity}] ${i.actual ?? ""}`));
	if (blockers.length === 0 && p0p1.length === 0) return { ok: true };
	const files = [".xdd/runs/*/blind-journey/results.json"];
	const parts = [
		blockers.length > 0 ? `阻断场景: ${blockers.map((r) => `${r.roleId}/${r.scenarioId}:${r.verdict}`).join(", ")}` : "",
		p0p1.length > 0 ? `P0/P1: ${p0p1.join(", ")}` : "",
	].filter(Boolean).join("；");
	return fail("BLIND_JOURNEY_FAILED", `Blind Journey Gate: ${parts}`, files, "修复 P0/P1、FAIL、BLOCKED、INCONCLUSIVE 后重新运行 Blind Journey；纯后端项目移除未适用的角色定义。");
}

function discoverValidationCommands(cwd: string): string[] {
	if (existsSync(join(cwd, "package.json"))) return ["npm test"];
	if (existsSync(join(cwd, "go.mod"))) return ["go test ./..."];
	if (existsSync(join(cwd, "Makefile"))) return ["make test"];
	return [];
}

async function runValidationCommand(cwd: string, command: string): Promise<{ ok: true } | { ok: false; message: string }> {
	try {
		await execFileAsync("bash", ["-lc", command], { cwd, timeout: 180000, maxBuffer: 1024 * 1024, env: { ...process.env, CI: "true" } });
		return { ok: true };
	} catch (e) {
		const err = e as { code?: number; stderr?: string | Buffer; stdout?: string | Buffer };
		const stderr = (err.stderr ?? err.stdout ?? "").toString().slice(0, 800);
		return { ok: false, message: `验证命令 ${command} 失败（退出码 ${err.code ?? "?"}）${stderr ? "\n" + stderr : ""}` };
	}
}

function blindJourneyRolesExist(cwd: string): boolean {
	const runsDir = join(cwd, ".xdd", "runs");
	try {
		const rolesDir = join(runsDir, XDD_RUN_DIR, "blind-journey", "roles");
		if (existsSync(rolesDir) && readdirSync(rolesDir).some((f) => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".md"))) return true;
	} catch { /* no runs dir */ }
	return false;
}

function currentRunDir(cwd: string): string | null {
	const runs = join(cwd, ".xdd", "runs");
	const xddRun = join(runs, XDD_RUN_DIR);
	if (existsSync(xddRun) && statSync(xddRun).isDirectory()) return XDD_RUN_DIR;
	return null;
}

function unfinishedPlanFiles(activeRunDir: string, cwd: string): string[] {
	const planFiles = walk(activeRunDir).filter((file) => file.endsWith("plan.md"));
	return planFiles.filter((file) => hasUnfinishedPlanCheckbox(readFileSync(file, "utf8"))).map((file) => relative(cwd, file));
}

function validateEvidenceRefs(cwd: string, runDir: string, report: string): VerifyEvidenceGateResult | null {
	const refs = extractEvidenceReferences(report);
	if (refs.length === 0) return fail("EVIDENCE_MISSING", "verify Gate: verify-report.md 未引用当前 run evidence 文件", [`.xdd/runs/${runDir}/evidence`], "把命令输出、HTTP 响应、截图/DOM 等证据写入 evidence 目录，并在报告中引用路径。");
	const evidenceRoot = realpathOrResolve(join(cwd, ".xdd", "runs", runDir, "evidence"));
	const missing: string[] = [];
	for (const ref of refs) {
		if (!ref.startsWith(`.xdd/runs/${runDir}/evidence/`)) {
			missing.push(ref);
			continue;
		}
		const abs = resolve(cwd, ref);
		if (!existsSync(abs)) {
			missing.push(ref);
			continue;
		}
		const real = realpathOrResolve(abs);
		if (relative(evidenceRoot, real).startsWith("..")) missing.push(ref);
	}
	return missing.length > 0 ? fail("EVIDENCE_MISSING", "verify Gate: evidence 引用缺失、逃逸或来自其它 run", missing, "仅引用当前 run evidence 目录中真实存在的文件。") : null;
}

function hasWireArtifacts(cwd: string): boolean {
	const dir = join(cwd, ".xdd", "design", "wire");
	return walk(dir).some((file) => file.endsWith(".md") && statSync(file).size > 0);
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

function fail(code: EvidenceGateFailureCode, message: string, files: string[], remediation: string): VerifyEvidenceGateResult {
	return evidenceFailureToGateResult({ code, message, files, remediation });
}
