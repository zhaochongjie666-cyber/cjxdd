/**
 * Blind Journey validation logic: Gherkin parsing (Then-stripping for actor
 * isolation), actor/judge prompt generation, report writing, result aggregation.
 *
 * The Actor only sees Given+When (situation + goal). The Judge sees the full
 * Feature + the actor's evidence. This split prevents the actor from
 * "goal-oriented cheating" -- searching for the expected result text instead
 * of genuinely completing the user journey.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import type {
	XddBlindJourneyResult,
	XddBlindJourneyVerdict,
	XddBlindJourneySeverity,
	XddBlindJourneyIssue,
	XddParsedScenario,
} from "./types.ts";

// ── Gherkin parsing ─────────────────────────────────────────────────────

/** Keywords for Gherkin steps in both English and Chinese. */
const GIVEN_RE = /^\s*(?:Given|假如|假设|前提)\s+/i;
const WHEN_RE = /^\s*(?:When|当|那么当)\s+/i;
const THEN_RE = /^\s*(?:Then|那么)\s+/i;
const AND_RE = /^\s*(?:And|But|而且|并且|但是)\s+/i;
const SCENARIO_RE = /^\s*(?:Scenario|场景)\s*(?:Outline|大纲)?\s*:\s*(.+)$/i;
const FEATURE_RE = /^\s*(?:Feature|功能)\s*:\s*(.+)$/i;
const TAG_RE = /^\s*@\S+/;

/**
 * Parse a .feature file and extract all scenarios with their Given/When/Then
 * steps split. Returns an array of parsed scenarios.
 */
export function parseFeatureFile(featurePath: string): {
	featureName: string;
	scenarios: XddParsedScenario[];
} {
	const content = readFileSync(featurePath, "utf8");
	const lines = content.split("\n");
	let featureName = "";
	const scenarios: XddParsedScenario[] = [];
	let current: XddParsedScenario | null = null;
	let pendingTags: string[] = [];
	let lastStepType: "given" | "when" | "then" | null = null;

	for (const line of lines) {
		// Collect tags for the next scenario
		if (TAG_RE.test(line)) {
			pendingTags.push(...line.trim().split(/\s+/).filter((t) => t.startsWith("@")));
			continue;
		}
		const fm = line.match(FEATURE_RE);
		if (fm) {
			featureName = fm[1].trim();
			pendingTags = [];
			continue;
		}
		const sm = line.match(SCENARIO_RE);
		if (sm) {
			if (current) scenarios.push(current);
			current = {
				featureName,
				scenarioName: sm[1].trim(),
				tags: pendingTags,
				given: [],
				when: [],
				then: [],
			};
			pendingTags = [];
			lastStepType = null;
			continue;
		}
		if (!current) continue;

		if (GIVEN_RE.test(line)) {
			current.given.push(stripKeyword(line, GIVEN_RE));
			lastStepType = "given";
		} else if (WHEN_RE.test(line)) {
			current.when.push(stripKeyword(line, WHEN_RE));
			lastStepType = "when";
		} else if (THEN_RE.test(line)) {
			current.then.push(stripKeyword(line, THEN_RE));
			lastStepType = "then";
		} else if (AND_RE.test(line)) {
			// "And" continues the last step type
			const text = stripKeyword(line, AND_RE);
			if (lastStepType === "given") current.given.push(text);
			else if (lastStepType === "when") current.when.push(text);
			else if (lastStepType === "then") current.then.push(text);
		}
	}
	if (current) scenarios.push(current);
	return { featureName, scenarios };
}

function stripKeyword(line: string, re: RegExp): string {
	return line.replace(re, "").trim();
}

/**
 * Find a scenario by ID (tag like @AC-01) or by name substring.
 */
export function findScenario(
	scenarios: XddParsedScenario[],
	scenarioId: string,
): XddParsedScenario | undefined {
	// Try tag match first (@AC-01)
	let found = scenarios.find((s) =>
		s.tags.some((t) => t.toLowerCase() === `@${scenarioId.toLowerCase()}`),
	);
	if (found) return found;
	// Try name substring match
	found = scenarios.find((s) => s.scenarioName.includes(scenarioId));
	return found;
}

// ── Actor prompt (Given+When only, NO Then) ─────────────────────────────

/**
 * Build the Journey Actor prompt. The actor sees ONLY:
 * - Role definition (identity, permissions, business goal, unknown knowledge)
 * - Current situation (from Given steps)
 * - User goal (from When steps)
 * - Product entry URL
 *
 * The actor does NOT see:
 * - Then steps (expected results) -- prevents goal-oriented cheating
 * - Feature name / scenario name (could hint at expected behavior)
 * - Any code, architecture, API, or test information
 */
export function buildActorPrompt(params: {
	roleDef: string;
	situation: string;
	goal: string;
	entryUrl: string;
	credentialRef?: string;
	reportPath: string;
}): string {
	return `你正在模拟一个真实产品用户。
你不是开发人员、测试工程师或系统管理员。
你不知道产品内部如何实现，也不能访问任何内部信息。

# 你的身份
${params.roleDef}

# 当前情况
${params.situation}

# 你的目标
${params.goal}

# 产品入口
${params.entryUrl}
${params.credentialRef ? `\n# 登录凭据\n${params.credentialRef}（运行时自动注入登录表单，不要写入报告和日志）\n` : ""}
# 操作规则
你只能执行普通用户可以执行的浏览器操作：
open / navigate / screenshot / click / double_click / type / keypress
scroll / hover / wait / back / forward / refresh / upload_user_file / download_user_visible_file

禁止：
- 查看源代码 / DOM / CSS Selector / XPath / data-testid
- 查看网络请求 / 浏览器控制台 / 执行 JavaScript
- 调用 API / 访问数据库 / 查看内部日志
- 读取架构或测试文档
- 向开发 Agent 询问操作方法

# 执行状态机
每一步操作前，记录：
1. 当前页面向用户表达了什么。
2. 你认为下一步应该做什么。
3. 为什么一个真实的当前角色会这样操作。

每一步操作后，记录：
1. 页面发生了什么变化。
2. 系统是否给出明确反馈。
3. 你是否更接近目标。
4. 是否产生困惑、错误或错误路径。

# 预算限制
- 最多 40 次操作
- 最多 5 次错误方向
- 每个操作最多重试 2 次
- 同一页面最多循环 3 次
- 最长 600 秒

# 判断规则
只根据用户可以看到的证据判断结果。
没有足够证据时，必须输出 INCONCLUSIVE。
无法继续时，必须输出 BLOCKED。
禁止因为"系统理论上应该成功"而输出 PASS。

# 产出
将你的操作旅途记录到：
${params.reportPath}

格式：
## 实际旅途
1. [操作] ... → [观察] ...
2. ...

## 最终判断
- Verdict: PASS | PASS_WITH_FRICTION | FAIL | BLOCKED | INCONCLUSIVE
- 理由: ...
- 证据: screenshot-01, screenshot-02, ...

## 体验问题（如有）
### UX-001: [问题标题]
- 等级: P0|P1|P2|P3|P4
- 发生位置: ...
- 用户预期: ...
- 实际表现: ...
- 用户影响: ...
- 证据: ...`;
}

// ── Judge prompt (full Feature + evidence) ──────────────────────────────

/**
 * Build the Acceptance Judge prompt. The judge sees:
 * - Full Feature (including Then clauses)
 * - Journey Actor's recorded journey + evidence
 *
 * The judge does NOT see code, API, DB, or internal logs.
 */
export function buildJudgePrompt(params: {
	featureContent: string;
	journeyReportPath: string;
	resultReportPath: string;
}): string {
	return `你是验收裁判（Acceptance Judge）。
你的任务是判断 Journey Actor 的操作是否满足 Feature 的验收条件。

# 完整 Feature
${params.featureContent}

# Journey Actor 的操作轨迹和证据
请读取以下文件获取 Actor 的完整旅途记录：
${params.journeyReportPath}

# 判断标准
1. 用户是否通过正常产品入口完成了目标？
2. Feature 的每个 Then 是否有可见证据支持？
3. 是否存在"错误成功"（页面显示成功但实际未完成）？
4. 是否存在体验阻碍？
5. 是否存在权限或数据泄露？
6. 证据是否足够？

# 验收结果（只能选一个）
- PASS: 用户通过正常入口完成目标，所有 Feature 断言均有可见证据。
- PASS_WITH_FRICTION: 业务目标完成，但存在明显体验障碍（入口难发现/反馈模糊/需多次尝试）。
- FAIL: 系统行为与 Feature 明确冲突（无权限角色完成受限操作/状态不正确/数据错误）。
- BLOCKED: 用户在正常操作范围内无法继续（无法登录/页面持续加载/入口不存在）。
- INCONCLUSIVE: 证据不足，无法确认通过或失败（无可见成功状态/刷新后结果消失）。

BLOCKED 和 INCONCLUSIVE 都不能作为通过处理。

# 体验问题等级
- P0: 安全或数据隔离问题（直接阻止发布）
- P1: 核心旅途无法完成（直接阻止发布）
- P2: 可以完成但有严重阻碍（默认阻止，允许豁免）
- P3: 一般体验问题（不阻止，进待办）
- P4: 建议

# 产出
将你的验收判断记录到：
${params.resultReportPath}

格式：
# Blind Journey Experience Report
## 基本信息
- Feature: [Feature 名称]
- Scenario: [场景名称]
- Role: [角色名称]
- Started At / Finished At: ...

## 最终结论
- Result: PASS | PASS_WITH_FRICTION | FAIL | BLOCKED | INCONCLUSIVE
- Severity: P0|P1|P2|P3|P4 (如有问题)
- Confidence: High | Medium | Low

## Feature 验证
| 验收条件 | 观察结果 | 证据 | 结论 |
|---|---|---|---|
| [Then 步骤] | [观察] | [screenshot-XX] | 通过/未通过 |

## 体验问题
### UX-001: [问题标题]
- 等级: P0|P1|P2|P3|P4
- 角色: ...
- 发生位置: ...
- 用户预期: ...
- 实际表现: ...
- 用户影响: ...
- 证据: ...

## 未确认事项
（如有无法通过当前角色可见页面确认的验收项）`;
}

// ── Report paths ────────────────────────────────────────────────────────

/** Base directory for blind journey artifacts under the current run. */
export function blindJourneyDir(cwd: string): string {
	// Find the most recent runs/iter-* directory
	const runsDir = join(cwd, ".xdd", "runs");
	let iterDir = "";
	try {
		const entries = readdirSync(runsDir, { withFileTypes: true });
		const iters = entries
			.filter((e) => e.isDirectory() && e.name.startsWith("iter-"))
			.sort()
			.reverse();
		if (iters.length > 0) iterDir = iters[0].name;
	} catch { /* no runs dir */ }
	if (!iterDir) iterDir = "iter-1";
	return join(cwd, ".xdd", "runs", iterDir, "blind-journey");
}

/** Journey report path for a specific role + scenario. */
export function journeyReportPath(cwd: string, roleId: string, scenarioId: string): string {
	return join(blindJourneyDir(cwd), "journeys", `${roleId}_${scenarioId}.md`);
}

/** Results file path (structured JSON for gate checking). */
export function resultsFilePath(cwd: string): string {
	return join(blindJourneyDir(cwd), "results.json");
}

/** Coverage report path. */
export function coverageReportPath(cwd: string): string {
	return join(blindJourneyDir(cwd), "coverage-report.md");
}

// ── Result recording & aggregation ──────────────────────────────────────

/** Read all recorded blind journey results from results.json. */
export function readResults(cwd: string): XddBlindJourneyResult[] {
	const p = resultsFilePath(cwd);
	if (!existsSync(p)) return [];
	try {
		return JSON.parse(readFileSync(p, "utf8")) as XddBlindJourneyResult[];
	} catch {
		return [];
	}
}

/** Append or update a result in results.json. */
export function recordResult(cwd: string, result: XddBlindJourneyResult): void {
	const results = readResults(cwd);
	const idx = results.findIndex(
		(r) => r.scenarioId === result.scenarioId && r.roleId === result.roleId,
	);
	if (idx >= 0) results[idx] = result;
	else results.push(result);
	const dir = dirname(resultsFilePath(cwd));
	mkdirSync(dir, { recursive: true });
	writeFileSync(resultsFilePath(cwd), JSON.stringify(results, null, 2), "utf8");
}

/** Generate the role coverage report from all recorded results. */
export function generateCoverageReport(cwd: string): string {
	const results = readResults(cwd);
	const byRole = new Map<string, XddBlindJourneyResult[]>();
	for (const r of results) {
		const list = byRole.get(r.roleId) ?? [];
		list.push(r);
		byRole.set(r.roleId, list);
	}

	const lines: string[] = [
		"# Blind Journey Coverage Report",
		"",
		"| 角色 | 场景数 | PASS | PASS_WITH_FRICTION | FAIL | BLOCKED | INCONCLUSIVE |",
		"|---|---:|---:|---:|---:|---:|---:|",
	];

	let totalPass = 0;
	let totalFriction = 0;
	let totalFail = 0;
	let totalBlocked = 0;
	let totalInconclusive = 0;

	for (const [roleId, list] of byRole) {
		const pass = list.filter((r) => r.verdict === "PASS").length;
		const friction = list.filter((r) => r.verdict === "PASS_WITH_FRICTION").length;
		const fail = list.filter((r) => r.verdict === "FAIL").length;
		const blocked = list.filter((r) => r.verdict === "BLOCKED").length;
		const inconclusive = list.filter((r) => r.verdict === "INCONCLUSIVE").length;
		totalPass += pass;
		totalFriction += friction;
		totalFail += fail;
		totalBlocked += blocked;
		totalInconclusive += inconclusive;
		const roleName = list[0]?.roleName ?? roleId;
		lines.push(
			`| ${roleName} (${roleId}) | ${list.length} | ${pass} | ${friction} | ${fail} | ${blocked} | ${inconclusive} |`,
		);
	}

	const total = results.length;
	lines.push(
		`| **合计** | **${total}** | **${totalPass}** | **${totalFriction}** | **${totalFail}** | **${totalBlocked}** | **${totalInconclusive}** |`,
	);
	lines.push("");

	// P0/P1 issues
	const p0p1 = results.flatMap((r) =>
		(r.issues ?? [])
			.filter((i) => i.severity === "P0" || i.severity === "P1")
			.map((i) => ({ ...i, scenarioId: r.scenarioId, roleId: r.roleId })),
	);
	if (p0p1.length > 0) {
		lines.push("## P0/P1 问题（阻止发布）");
		for (const issue of p0p1) {
			lines.push(`- **${issue.id}** [${issue.severity}] ${issue.scenarioId}/${issue.roleId}: ${issue.actual} @ ${issue.location}`);
		}
		lines.push("");
	}

	// Overall verdict
	const hasFail = totalFail > 0;
	const hasBlocked = totalBlocked > 0;
	const hasP0P1 = p0p1.length > 0;
	const verdict = hasFail || hasP0P1
		? "FAIL"
		: hasBlocked
			? "BLOCKED"
			: totalInconclusive > 0
				? "INCONCLUSIVE"
				: totalFriction > 0
					? "PASS_WITH_FRICTION"
					: totalPass > 0
						? "PASS"
						: "INCONCLUSIVE";

	lines.push(`## 总体验收结论: ${verdict}`);

	// Write report
	writeFileSync(coverageReportPath(cwd), lines.join("\n"), "utf8");
	return lines.join("\n");
}

/** Compute the overall blind journey verdict from results. */
export function computeOverallVerdict(cwd: string): "pass" | "fail" | "pending" | "skipped" {
	const results = readResults(cwd);
	if (results.length === 0) return "pending";
	const hasFail = results.some((r) => r.verdict === "FAIL");
	const hasBlocked = results.some((r) => r.verdict === "BLOCKED");
	const hasP0P1 = results.some((r) =>
		(r.issues ?? []).some((i) => i.severity === "P0" || i.severity === "P1"),
	);
	if (hasFail || hasP0P1) return "fail";
	if (hasBlocked) return "fail";
	return "pass";
}

/** Create the journey report skeleton file. */
export function createReportSkeleton(reportPath: string, roleDef: string, situation: string, goal: string): void {
	mkdirSync(dirname(reportPath), { recursive: true });
	const skeleton = `# Blind Journey Report

## 角色定义
${roleDef}

## 当前情况
${situation}

## 用户目标
${goal}

## 实际旅途
（执行操作后在此记录每一步操作和观察）

## 最终判断
- Verdict: (待填写)
- 理由: (待填写)
- 证据: (待填写)
`;
	writeFileSync(reportPath, skeleton, "utf8");
}

/** Build situation text from Given steps. */
export function buildSituation(given: string[]): string {
	if (given.length === 0) return "（无特殊前置状态）";
	return given.map((g, i) => `${i + 1}. ${g}`).join("\n");
}

/** Build goal text from When steps. */
export function buildGoal(when: string[]): string {
	if (when.length === 0) return "（未指定操作目标）";
	return when.map((w) => w).join("；");
}
