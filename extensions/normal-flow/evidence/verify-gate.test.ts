import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	evaluateNormalFlowVerifyGate,
	evaluateNormalFlowVerifyGateFull,
} from "./verify-gate.ts";
import { ensureVerifySnapshot } from "../../xdd/policy/verify-snapshot.ts";

function project(): string {
	const cwd = mkdtempSync(join(tmpdir(), "nf-verify-gate-"));
	mkdirSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "responses"), { recursive: true });
	mkdirSync(join(cwd, ".xdd", "design", "spec", "b01"), { recursive: true });
	writeFileSync(join(cwd, ".xdd", "design", "spec", "b01", "rules.md"), "| ID | Rule |\n| R01 | rule |\n", "utf8");
	writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "plan.md"), "# Plan\n- [x] done\n", "utf8");
	return cwd;
}

function longReport(extra = ""): string {
	return `# Verify Report\n\nRuntime evidence: npm test exited 0. HTTP evidence: curl GET /api/items returned status 200. Evidence file: .xdd/runs/normal_run/evidence/runtime.txt\n\nFeature Scenario verified: auth.feature :: Scenario: 用户登录成功\n\n${extra}\n\n${"真实验证说明".repeat(80)}`;
}

function writePassingBaseEvidence(cwd: string, extra = ""): void {
	writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"), longReport(extra), "utf8");
	writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "runtime.txt"), "runtime ok", "utf8");
	writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "health-check.txt"), "status_code: 200\nbody ok\n", "utf8");
	writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "responses", "items.html"), "<html>ok</html>\nstatus_code: 200\n", "utf8");
	writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "responses", "unauthorized.json"), "status_code: 401\nunauthorized\n", "utf8");
	writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "wander-report.md"),
		`# Wander Report
- Base URL: http://localhost:8000
- Feature Scenario: .xdd/design/spec/b01/auth.feature :: Scenario: 用户登录成功

### Step 1: 进入入口
- 操作: curl http://localhost:8000/
- 观察: 200 OK
- 结果: PASS
- 证据: .xdd/runs/normal_run/evidence/responses/get_root.html

### Step 2: 登录
- 操作: POST /api/login
- 观察: 200 token
- 结果: PASS
- 证据: .xdd/runs/normal_run/evidence/responses/login.html

### Step 3: 验证兜底
- 操作: GET /api/private without token
- 观察: 401
- 结果: PASS
- 证据: .xdd/runs/normal_run/evidence/responses/unauthorized.json

## 最终判断
- Verdict: PASS
- 理由: 完整漫游通过，含兜底
`,
		"utf8",
	);
}

describe("Normal Flow verify evidence gate (真实可用契约)", () => {
	it("fails when verify-report.md is missing", () => {
		const cwd = project();
		try {
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			// project() 会预创建 .xdd/runs/normal_run/evidence/responses/，所以走
			// 到 REPORT_MISSING（runDir 存在但 report 缺失），不是 RUN_DIR_MISSING。
			expect(r.failure?.code).toBe("REPORT_MISSING");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails with RUN_DIR_MISSING when .xdd/runs/normal_run does not exist at all", () => {
		const cwd = mkdtempSync(join(tmpdir(), "nf-no-run-"));
		try {
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("RUN_DIR_MISSING");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails when verify-report.md is too short", () => {
		const cwd = project();
		try {
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"), "short", "utf8");
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("REPORT_TOO_SHORT");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails when there are unfinished plan checkboxes (no fake PASS)", () => {
		const cwd = project();
		try {
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "plan.md"), "- [ ] unfinished\n", "utf8");
			writePassingBaseEvidence(cwd);
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("PLAN_UNFINISHED");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails when health-check.txt is missing (cannot prove service actually starts)", () => {
		const cwd = project();
		try {
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"), longReport(), "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "runtime.txt"), "runtime ok", "utf8");
			// no health-check.txt
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("HEALTH_CHECK_MISSING");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails when health-check.txt has no success status code", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "health-check.txt"), "500\ninternal error\n", "utf8");
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("HEALTH_CHECK_MISSING");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails when only /healthz endpoint is exercised (no real business endpoint)", () => {
		const cwd = project();
		try {
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
				longReport("HTTP evidence: GET /healthz returned status 200. Evidence: .xdd/runs/normal_run/evidence/responses/healthz.html"),
				"utf8",
			);
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "runtime.txt"), "runtime ok", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "health-check.txt"), "200\n", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "responses", "healthz.html"), "status_code: 200\n", "utf8");
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "evidence", "wander-report.md"),
				`# Wander Report\n### Step 1\n- 操作: GET /healthz\n- 观察: 200\n- 结果: PASS\n- 证据: .xdd/runs/normal_run/evidence/responses/healthz.html\n### Step 2\n- 操作: GET /healthz again\n- 观察: 200\n- 结果: PASS\n- 证据: .xdd/runs/normal_run/evidence/responses/healthz.html\n### Step 3\n- 操作: GET /healthz third\n- 观察: 200\n- 结果: PASS\n- 证据: .xdd/runs/normal_run/evidence/responses/healthz.html\n`,
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			// 只跳 healthz、且完全没有兑底/负向证据，两条 gate 都违反：
			// FALLBACK_EVIDENCE_MISSING 优先于 BUSINESS_ENDPOINT_UNTESTED。
			expect(r.failure?.code).toBe("FALLBACK_EVIDENCE_MISSING");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails when fallback/negative-path evidence is missing (no 4xx/5xx, no rejection keywords)", () => {
		const cwd = project();
		try {
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
				longReport(),
				"utf8",
			);
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "runtime.txt"), "runtime ok", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "health-check.txt"), "200\n", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "responses", "items.html"), "<html>ok</html>\nstatus_code: 200\n", "utf8");
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "evidence", "wander-report.md"),
				`# Wander Report\n### Step 1\n- 操作: GET /\n- 观察: 200\n- 结果: PASS\n- 证据: .xdd/runs/normal_run/evidence/responses/items.html\n### Step 2\n- 操作: GET /api/items\n- 观察: 200\n- 结果: PASS\n- 证据: .xdd/runs/normal_run/evidence/responses/items.html\n### Step 3\n- 操作: GET /api/items/1\n- 观察: 200\n- 结果: PASS\n- 证据: .xdd/runs/normal_run/evidence/responses/items.html\n`,
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("FALLBACK_EVIDENCE_MISSING");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails when wander-report.md is missing", () => {
		const cwd = project();
		try {
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"), longReport(), "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "runtime.txt"), "runtime ok", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "health-check.txt"), "200\n", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "responses", "items.html"), "<html>ok</html>\nstatus_code: 200\n", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "responses", "unauth.json"), "status_code: 401\n", "utf8");
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("WANDER_REPORT_MISSING");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails when wander-report has fewer than 3 steps", () => {
		const cwd = project();
		try {
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"), longReport(), "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "runtime.txt"), "runtime ok", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "health-check.txt"), "200\n", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "responses", "items.html"), "<html>ok</html>\nstatus_code: 200\n", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "responses", "unauth.json"), "status_code: 401\n", "utf8");
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "evidence", "wander-report.md"),
				`# Wander Report\n### Step 1\n- 操作: GET /\n- 观察: 200\n- 结果: PASS\n- 证据: .xdd/runs/normal_run/evidence/responses/items.html\n`,
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("WANDER_REPORT_MISSING");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails when verify-report references evidence from another run (xdd_run)", () => {
		const cwd = project();
		try {
			mkdirSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence"), { recursive: true });
			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence", "old.txt"), "old", "utf8");
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
				longReport("Evidence .xdd/runs/xdd_run/evidence/old.txt"),
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("EVIDENCE_FROM_OTHER_RUN");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("fails when wire artifacts exist but no UI evidence in report", () => {
		const cwd = project();
		try {
			mkdirSync(join(cwd, ".xdd", "design", "wire"), { recursive: true });
			writeFileSync(join(cwd, ".xdd", "design", "wire", "home.md"), "wireframe content", "utf8");
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
				`# Verify Report\n\nRuntime evidence: npm test exited 0. HTTP evidence: curl GET /api/items returned status 200. Evidence file: .xdd/runs/normal_run/evidence/runtime.txt\n\n${"真实验证说明".repeat(80)}`,
				"utf8",
			);
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "runtime.txt"), "runtime ok", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "health-check.txt"), "200\n", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "responses", "items.html"), "<html>ok</html>\nstatus_code: 200\n", "utf8");
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "responses", "unauth.json"), "status_code: 401\n", "utf8");
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "evidence", "wander-report.md"),
				`# Wander Report\n### Step 1\n- 操作: GET /\n- 观察: 200\n- 结果: PASS\n- 证据: .xdd/runs/normal_run/evidence/responses/items.html\n### Step 2\n- 操作: GET /api/items\n- 观察: 200\n- 结果: PASS\n- 证据: .xdd/runs/normal_run/evidence/responses/items.html\n### Step 3\n- 操作: 401 check\n- 观察: 401\n- 结果: PASS\n- 证据: .xdd/runs/normal_run/evidence/responses/unauth.json\n`,
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("UI_EVIDENCE_MISSING");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("passes full happy path with health-check + business endpoint + fallback + wander-report", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("passes when wire artifacts exist and UI evidence is in the report (screenshot path)", () => {
		const cwd = project();
		try {
			mkdirSync(join(cwd, ".xdd", "design", "wire"), { recursive: true });
			writeFileSync(join(cwd, ".xdd", "design", "wire", "home.md"), "wireframe content", "utf8");
			mkdirSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "screenshots"), { recursive: true });
			writeFileSync(join(cwd, ".xdd", "runs", "normal_run", "evidence", "screenshots", "home.png"), "PNG", "utf8");
			writePassingBaseEvidence(
				cwd,
				"UI evidence: screenshot saved to .xdd/runs/normal_run/evidence/screenshots/home.png",
			);
			const r = evaluateNormalFlowVerifyGate(cwd);
			expect(r.ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("Normal Flow verify gate - 追溯闭合 + 退改护栏", () => {
	/** 全量「真实可用契约」 pass 的脚手架：补齐 trace / scenario / per-RXX / wandering。 */
	function writeFullPassingEvidence(cwd: string): void {
		// source code + @implements 闭合
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(join(cwd, "src", "app.ts"), "// @implements R01\nexport const ok = true;\n", "utf8");
		// spec + .feature
		writeFileSync(join(cwd, ".xdd", "design", "spec", "b01", "rules.md"), "| ID | Rule |\n| R01 | rule |\n", "utf8");
		writeFileSync(
			join(cwd, ".xdd", "design", "spec", "b01", "auth.feature"),
			`Feature: 用户登录
  Scenario: 用户登录成功
    Given 已注册
    When 提交正确密码
    Then 返回 200
`,
			"utf8",
		);
		// plan.md 必须有 ### Task + Feature/Implementation/Acceptance Test + Wandering Scenarios
		writeFileSync(
			join(cwd, ".xdd", "runs", "normal_run", "plan.md"),
			`# Plan
- [x] done

### Task auth-login
**Feature:** auth.feature :: Scenario: 用户登录成功
**Implementation:** src/app.ts
**Acceptance Test:** curl /api/login

## Wandering Scenarios
- Feature: .xdd/design/spec/b01/auth.feature
- Scenario: 用户登录成功
`,
			"utf8",
		);
		// verify-report.md 逐 RXX + 逐 Scenario 举证
		writeFileSync(
			join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
			longReport(`### R01: 登录成功
- Verdict: PASS
- Evidence: .xdd/runs/normal_run/evidence/responses/unauthorized.json

### Scenario: 用户登录成功
- Feature: auth.feature
- Verdict: PASS
- Evidence: .xdd/runs/normal_run/evidence/responses/unauthorized.json`),
			"utf8",
		);
		// wander 引用同一 .feature + Scenario
		writeFileSync(
			join(cwd, ".xdd", "runs", "normal_run", "evidence", "wander-report.md"),
			`# Wander Report
- Feature Scenario: .xdd/design/spec/b01/auth.feature :: Scenario: 用户登录成功

### Step 1: 进入入口
- 操作: GET /
- 观察: 200
- 结果: PASS
- 证据: .xdd/runs/normal_run/evidence/responses/items.html

### Step 2: 登录
- 操作: POST /api/login
- 观察: 200
- 结果: PASS
- 证据: .xdd/runs/normal_run/evidence/responses/items.html

### Step 3: 兏底
- 操作: GET /api/private
- 观察: 401
- 结果: PASS
- 证据: .xdd/runs/normal_run/evidence/responses/unauthorized.json
`,
			"utf8",
		);
	}

	it("Full gate (evidence + mutation + trace + scenario + perRXX + wandering) passes end-to-end", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: VERIFY_MUTATED_CONTRACT when verify stage modifies src/", () => {
		const cwd = project();
		try {
			// 先走一遍基础 evidence 让前几道 gate 通过。
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			// 模拟 before_agent_start hook：verify 阶段入场立即锁定快照。
			ensureVerifySnapshot(cwd);
			// 验证中偷偷改 src/。
			mkdirSync(join(cwd, "src"), { recursive: true });
			writeFileSync(join(cwd, "src", "cheat.ts"), "// @implements R01\nconsole.log('cheat');\n", "utf8");
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("VERIFY_MUTATED_CONTRACT");
			expect(r.failure?.files.some((f) => f.includes("cheat.ts"))).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: TRACE_GAP when spec RXX has no @implements annotation", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			// 删掉 @implements。避免在注释里残留 @implements 字符串以免拖住 IMPLEMENTS_RE。
			writeFileSync(join(cwd, "src", "app.ts"), "// missing implements marker\nexport const ok = true;\n", "utf8");
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("TRACE_GAP");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: FEATURE_SCENARIO_GAP when .feature Scenario has no plan Task mapping", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			// plan.md 去掉 ### Task 块，仅剩 Wandering。
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "plan.md"),
				`# Plan
- [x] done

## Wandering Scenarios
- Feature: .xdd/design/spec/b01/auth.feature
- Scenario: 用户登录成功
`,
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("FEATURE_SCENARIO_GAP");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: RXX_UNTESTED when verify-report says '全部通过' instead of per-RXX", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			// 覆盖为「全部通过」型空洞报告。
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
				`# Verify Report

全部通过。Runtime evidence: npm test exited 0. HTTP evidence: curl GET /api/items returned status 200. Evidence file: .xdd/runs/normal_run/evidence/runtime.txt

Feature Scenario verified: auth.feature :: Scenario: 用户登录成功

${"真实验证说明".repeat(80)}`,
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("RXX_UNTESTED");
			expect(r.failure?.message).toContain("R01");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: RXX_UNTESTED when per-RXX block exists but Verdict is vague (e.g. '已验证')", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
				longReport(`### R01: 登录成功
- Verdict: 已验证
- Evidence: .xdd/runs/normal_run/evidence/responses/unauthorized.json`),
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("RXX_UNTESTED");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: WANDERING_NOT_WALKED when plan declares wandering scenario but wander-report.md doesn't include it", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			// wander-report.md 写另一个 feature；verify-report.md 也调为引用同一但 wander 还没走 plan 那个。
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "evidence", "wander-report.md"),
				`# Wander Report
- Feature Scenario: .xdd/design/spec/b01/other.feature :: Scenario: 别的东西

### Step 1: enter
- 操作: GET /
- 观察: 200
- 结果: PASS

### Step 2: do thing
- 操作: POST /api/other
- 观察: 200
- 结果: PASS

### Step 3: 兏底
- 操作: GET /api/private
- 观察: 401
- 结果: PASS
`,
				"utf8",
			);
			// verify-report 改报 other.feature （WANDER_FEATURE_UNMAPPED 不再被跳出来）。
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
				longReport(`Feature Scenario verified: other.feature :: Scenario: 别的东西
### R01: 登录成功
- Verdict: PASS
- Evidence: .xdd/runs/normal_run/evidence/responses/unauthorized.json

### Scenario: 用户登录成功
- Feature: auth.feature
- Verdict: PASS
- Evidence: .xdd/runs/normal_run/evidence/responses/unauthorized.json`),
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("WANDERING_NOT_WALKED");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: pass when plan has Wandering Scenarios and wander-report references them", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: SCENARIO_NOT_IMPLEMENTED when plan Implementation: path does not exist on disk", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			// plan 指向不存在的源文件
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "plan.md"),
				`# Plan
- [x] done

### Task auth-login
**Feature:** auth.feature :: Scenario: 用户登录成功
**Implementation:** src/nonexistent.ts
**Acceptance Test:** curl /api/login

## Wandering Scenarios
- Feature: .xdd/design/spec/b01/auth.feature
- Scenario: 用户登录成功
`,
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("SCENARIO_NOT_IMPLEMENTED");
			expect(r.failure?.message).toContain("src/nonexistent.ts");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: SCENARIO_UNVERIFIED when verify-report has no per-Scenario block", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			// 覆盖为只有 RXX 块、无 Scenario 块的报告
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
				longReport(`### R01: 登录成功
- Verdict: PASS
- Evidence: .xdd/runs/normal_run/evidence/responses/unauthorized.json`),
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("SCENARIO_UNVERIFIED");
			expect(r.failure?.message).toContain("用户登录成功");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: SCENARIO_UNVERIFIED when Scenario block exists but Verdict is vague", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
				longReport(`### R01: 登录成功
- Verdict: PASS
- Evidence: .xdd/runs/normal_run/evidence/responses/unauthorized.json

### Scenario: 用户登录成功
- Feature: auth.feature
- Verdict: 已测试
- Evidence: .xdd/runs/normal_run/evidence/responses/unauthorized.json`),
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("SCENARIO_UNVERIFIED");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: SCENARIO_UNVERIFIED when PASS verdict lacks Evidence reference", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			writeFileSync(
				join(cwd, ".xdd", "runs", "normal_run", "verify-report.md"),
				longReport(`### R01: 登录成功
- Verdict: PASS
- Evidence: .xdd/runs/normal_run/evidence/responses/unauthorized.json

### Scenario: 用户登录成功
- Feature: auth.feature
- Verdict: PASS
- Evidence: N/A`),
				"utf8",
			);
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(false);
			expect(r.failure?.code).toBe("SCENARIO_UNVERIFIED");
			expect(r.failure?.message).toContain("Evidence");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("Full gate: passes when every Scenario has Verdict + Evidence (Feature-driven verify)", () => {
		const cwd = project();
		try {
			writePassingBaseEvidence(cwd);
			writeFullPassingEvidence(cwd);
			const r = evaluateNormalFlowVerifyGateFull(cwd);
			expect(r.ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});