import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { XddGateResult } from "../types.ts";
import { readResults } from "../blind-journey.ts";
import { HarnessStore } from "../harness/store.ts";
import { buildTraceCoverage, observeFilesystem } from "../observe-fs.ts";
import { diffVerifySnapshot, formatVerifySnapshotDiff } from "../policy/verify-snapshot.ts";
import { detectEvidenceCategories, extractEvidenceReferences, hasUnfinishedPlanCheckbox } from "./report-parser.ts";

const execFileAsync = promisify(execFile);

export type EvidenceGateFailureCode =
	| "ITERATION_MISSING"
	| "REPORT_MISSING"
	| "REPORT_TOO_SHORT"
	| "PLAN_UNFINISHED"
	| "EVIDENCE_MISSING"
	| "EVIDENCE_INSUFFICIENT"
	| "UI_EVIDENCE_MISSING"
	| "BUSINESS_ENDPOINT_UNTESTED"
	| "VERIFY_COMMAND_FAILED"
	| "TRACE_GAP"
	| "VERIFY_MUTATED_CONTRACT"
	| "BLIND_JOURNEY_FAILED";

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
	const iteration = currentIteration(cwd);
	if (!iteration) return fail("ITERATION_MISSING", "verify Gate: 无法解析当前 iteration 目录", [".xdd/runs"], "创建 .xdd/runs/iter-N 并把本轮 plan/report/evidence 写入该目录。");
	const iterDir = join(cwd, ".xdd", "runs", iteration);
	const reportRel = `.xdd/runs/${iteration}/verify-report.md`;
	const reportAbs = join(cwd, reportRel);
	if (!existsSync(reportAbs)) return fail("REPORT_MISSING", "verify Gate: 缺少当前 iteration 的 verify-report.md", [reportRel], "在当前 iter 写入 verify-report.md，不能复用旧 iteration 报告。");
	const report = readFileSync(reportAbs, "utf8");
	if (report.trim().length < 300) return fail("REPORT_TOO_SHORT", "verify Gate: verify-report.md 正文过短，缺少真实验证说明", [reportRel], "补充真实命令、接口/UI/边界证据与结果，正文至少 300 字符。");
	const unfinished = unfinishedPlanFiles(iterDir, cwd);
	if (unfinished.length > 0) return fail("PLAN_UNFINISHED", "verify Gate: 当前 iteration 仍有未完成 plan checkbox", unfinished, "完成或明确移除当前 iter plan.md 中的 - [ ] 项，代码块示例不计。");
	const evidenceFailure = validateEvidenceRefs(cwd, iteration, report);
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
	const mutation = evaluateVerifyMutation(cwd);
	if (!mutation.ok) return mutation;
	const trace = evaluateTraceCoverage(cwd);
	if (!trace.ok) return trace;
	const commands = await evaluateHarnessValidationCommands(cwd);
	if (!commands.ok) return commands;
	const blind = evaluateBlindJourneyFailure(cwd);
	if (!blind.ok) return blind;
	return { ok: true };
}

export function evaluateVerifyMutation(cwd: string): VerifyEvidenceGateResult {
	const diff = diffVerifySnapshot(cwd);
	const files = [...diff.changed, ...diff.added, ...diff.deleted];
	if (files.length === 0) return { ok: true };
	return fail(
		"VERIFY_MUTATED_CONTRACT",
		"verify Gate: verify 阶段修改了源码或设计契约文件",
		files,
		`回滚到 execute 或对应设计阶段修复；verify 只允许写当前 iteration 的 report/evidence。变更: ${formatVerifySnapshotDiff(diff)}`,
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
		for (const iter of readdirSync(runsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("iter-")).sort((a, b) => b.name.localeCompare(a.name))) {
			const rolesDir = join(runsDir, iter.name, "blind-journey", "roles");
			if (existsSync(rolesDir) && readdirSync(rolesDir).some((f) => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".md"))) return true;
		}
	} catch { /* no runs dir */ }
	return false;
}

function currentIteration(cwd: string): string | null {
	const runs = join(cwd, ".xdd", "runs");
	try {
		const dirs = readdirSync(runs, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^iter-\d+/.test(entry.name)).map((entry) => entry.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
		return dirs.at(-1) ?? null;
	} catch {
		return null;
	}
}

function unfinishedPlanFiles(iterDir: string, cwd: string): string[] {
	const planFiles = walk(iterDir).filter((file) => file.endsWith("plan.md"));
	return planFiles.filter((file) => hasUnfinishedPlanCheckbox(readFileSync(file, "utf8"))).map((file) => relative(cwd, file));
}

function validateEvidenceRefs(cwd: string, iteration: string, report: string): VerifyEvidenceGateResult | null {
	const refs = extractEvidenceReferences(report);
	if (refs.length === 0) return fail("EVIDENCE_MISSING", "verify Gate: verify-report.md 未引用当前 iteration evidence 文件", [`.xdd/runs/${iteration}/evidence`], "把命令输出、HTTP 响应、截图/DOM 等证据写入 evidence 目录，并在报告中引用路径。");
	const evidenceRoot = realpathOrResolve(join(cwd, ".xdd", "runs", iteration, "evidence"));
	const missing: string[] = [];
	for (const ref of refs) {
		if (!ref.startsWith(`.xdd/runs/${iteration}/evidence/`)) {
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
	return missing.length > 0 ? fail("EVIDENCE_MISSING", "verify Gate: evidence 引用缺失、逃逸或来自旧 iteration", missing, "仅引用当前 iter evidence 目录中真实存在的文件。") : null;
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
