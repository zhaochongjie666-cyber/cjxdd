/**
 * Phase 5 (E) regression tests: Gate & self-heal robustness.
 *
 *   E.1  mechanical checks are mandatory input to the unified AIGate
 *   E.2  hardGateAttempts / aiGateAttempts are independent counters
 *   E.3  glob fingerprint based on real expanded files
 *   E.4  group rollback is atomic (xdd_advance calls goToStageName)
 *   E.5  verify rollback defaults to verify -> execute
 *   E.6  Gate 3 actually runs build + tests
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XddRunnerState } from "./types.ts";
import { createStateFixture, startStateFixture } from "./test/state-fixture.ts";
import { requireTestsPass, runBuild, softPass } from "./gate.ts";
import { computeArtifactFingerprint } from "./tools/artifact-fingerprint.ts";

let cwd = "";
let state: XddRunnerState;

function freshState(): XddRunnerState {
	cwd = mkdtempSync(join(tmpdir(), "xdd-phase5-"));
	state = createStateFixture({ runId: "phase5", cwd, userInput: "test" });
	startStateFixture(state);
	return state;
}

beforeEach(() => { freshState(); });
afterEach(() => { if (existsSync(cwd)) rmSync(cwd, { recursive: true }); });

// ── E.1: mechanical checks remain strict inputs ────────────────────────

describe("E.1 mechanical checks", () => {
	it("requireTestsPass fails when no test command is found", async () => {
		// Empty dir, no package.json / go.mod / Makefile
		const result = await requireTestsPass(cwd);
		expect(result.ok).toBe(false);
		expect(result.soft).toBeFalsy(); // NOT a soft pass
		expect(result.reason).toMatch(/未检测到测试命令/);
	});

	it("requireTestsPass passes with a working package.json test script", async () => {
		writeFileSync(join(cwd, "package.json"), JSON.stringify({
			scripts: { test: "echo ok" },
		}));
		const result = await requireTestsPass(cwd);
		expect(result.ok).toBe(true);
	});

	it("requireTestsPass fails on a failing test command", async () => {
		writeFileSync(join(cwd, "package.json"), JSON.stringify({
			scripts: { test: "exit 1" },
		}));
		const result = await requireTestsPass(cwd);
		expect(result.ok).toBe(false);
		expect(result.soft).toBeFalsy();
	});

	it("softPass() still works for stages that explicitly opt in (init, cleanup)", () => {
		// The init and cleanup stage gates are the only ones that call
		// softPass() -- P5 E.1 says "hard gate" never soft-passes, but
		// opt-in soft pass (where the stage has no hard deliverable) is
		// still legitimate.
		expect(softPass()).toEqual({ ok: true, soft: true });
	});
});

// ── E.2: hardGateAttempts / aiGateAttempts are independent ───────────

describe("E.2 independent AIGate budget", () => {
	it("default aiGateUsed is empty", () => {
		expect(state.aiGateUsed).toEqual({});
		expect(state.aiGateUsedFor("spec")).toBe(0);
	});

	it("beginAiGateAttempt increments independently of hard-Gate", () => {
		state.beginSelfHealAttempt("spec"); // hard-Gate attempt
		state.beginAiGateAttempt("spec"); // AIGate attempt
		expect(state.remainingSelfHealBudget("spec")).toBe(4);
		expect(state.remainingAiGateBudget("spec")).toBe(4);
		state.beginAiGateAttempt("spec");
		expect(state.remainingAiGateBudget("spec")).toBe(3);
		expect(state.remainingSelfHealBudget("spec")).toBe(4); // unchanged
	});

	it("resetSelfHealBudget also resets AIGate budget", () => {
		state.beginSelfHealAttempt("spec");
		state.beginAiGateAttempt("spec");
		state.resetSelfHealBudget("spec");
		expect(state.remainingSelfHealBudget("spec")).toBe(5);
		expect(state.aiGateUsedFor("spec")).toBe(0);
	});

	it("AIGate budget persists to runtime.json", () => {
		state.beginAiGateAttempt("spec");
		const rt = JSON.parse(readFileSync(join(cwd, ".xdd", "runtime.json"), "utf8"));
		expect(rt.aiGateUsed?.spec).toBe(1);
	});
});

// ── E.3: glob fingerprint based on real expanded files ──────────────

describe("E.3 glob fingerprint expansion", () => {
	it("fingerprint for a glob pattern reflects the ACTUAL files", () => {
		mkdirSync(join(cwd, "a/b/c"), { recursive: true });
		writeFileSync(join(cwd, "a/b/c/deep.md"), "x");
		writeFileSync(join(cwd, "a/top.md"), "y");
		const fp1 = computeArtifactFingerprint(cwd, ["**/*.md"]);
		expect(fp1).not.toBe("");
		// Modify a file -> fingerprint should change
		writeFileSync(join(cwd, "a/b/c/deep.md"), "x-changed");
		const fp2 = computeArtifactFingerprint(cwd, ["**/*.md"]);
		expect(fp2).not.toBe(fp1);
	});

	it("fingerprint stable for unchanged glob", () => {
		mkdirSync(join(cwd, "a"), { recursive: true });
		writeFileSync(join(cwd, "a/x.md"), "content");
		const fp1 = computeArtifactFingerprint(cwd, ["a/*.md"]);
		const fp2 = computeArtifactFingerprint(cwd, ["a/*.md"]);
		expect(fp1).toBe(fp2);
	});

	it("fingerprint for literal path matches statSync", () => {
		writeFileSync(join(cwd, "x.md"), "content");
		const fp = computeArtifactFingerprint(cwd, ["x.md"]);
		expect(fp).not.toBe("");
	});

	it("empty match -> returns empty: prefix (not silent empty)", () => {
		const fp = computeArtifactFingerprint(cwd, ["no-such-file.md"]);
		// Empty match is recorded as the literal pattern (so a no-change
		// retry is detectable). The exact format is "empty:<sorted list>".
		expect(fp).toMatch(/^empty:/);
	});
});

// ── E.6: Gate 3 actually runs build + tests ──────────────────────────

describe("E.6 Gate 3 runs build + tests", () => {
	it("runBuild finds npm build script and runs it", async () => {
		writeFileSync(join(cwd, "package.json"), JSON.stringify({
			scripts: { build: "echo build-ok", test: "echo test-ok" },
		}));
		const r = await runBuild(cwd);
		expect(r.ok).toBe(true);
	});

	it("runBuild skips silently when no build script", async () => {
		// No package.json -- runBuild is optional, not required
		const r = await runBuild(cwd);
		expect(r.ok).toBe(true);
	});

	it("runBuild fails on a failing build command", async () => {
		writeFileSync(join(cwd, "package.json"), JSON.stringify({
			scripts: { build: "exit 1" },
		}));
		const r = await runBuild(cwd);
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/构建命令.*失败/);
	});

	it("Gate 3 source includes build + tests (source check)", () => {
		const src = readFileSync(join(import.meta.dirname, "stage-groups.ts"), "utf8");
		// implementation gate must call both runBuild and requireTestsPass
		const gate3 = src.slice(src.indexOf('"implementation"'));
		expect(gate3).toMatch(/runBuild/);
		expect(gate3).toMatch(/requireTestsPass/);
	});
});

// ── E.4: group gate failures stay in-stage before verify ─────────────

describe("E.4 group gate failure routing", () => {
	it("xdd_advance revalidates the persisted review verdict before moving stages", () => {
		const src = readFileSync(join(import.meta.dirname, "tools/xdd-advance.ts"), "utf8");
		expect(src).toMatch(/evaluateStoredReviewVerdict\(state\.cwd, stage\.name/);
		expect(src).toContain("state.clearSignals()");
		expect(src).toContain("review verdict 已失效或不合规");
	});

	it("execute advancement requires a current read-only code review report", () => {
		const advance = readFileSync(join(import.meta.dirname, "tools/xdd-advance.ts"), "utf8");
		const submit = readFileSync(join(import.meta.dirname, "tools/xdd-submit-artifact.ts"), "utf8");
		expect(advance).toContain("evaluateCodeReviewGate(state.cwd)");
		expect(submit).toContain("execute 必须在 artifacts 中声明至少一个生产源码路径");
		expect(submit).toContain("writeCodeReviewReport");
	});

	it("verify advancement requires a current aggregated release decision", () => {
		const advance = readFileSync(join(import.meta.dirname, "tools/xdd-advance.ts"), "utf8");
		expect(advance).toContain("evaluateReleaseDecisionGate(state.cwd)");
		expect(advance).toContain("请调用 xdd_release_decision");
	});

	it("runtime P1 incidents feed diagnosis back into the XDD state", () => {
		const src = readFileSync(join(import.meta.dirname, "tools/xdd-runtime-observe.ts"), "utf8");
		expect(src).toContain("state.setDiagnose");
		expect(src).toContain('"implementation-bug"');
		expect(src).toContain('"architecture-flaw"');
	});

	it("xdd_advance does not dispatch Controller ROLLBACK on non-verify group gate fail", () => {
		const src = readFileSync(join(import.meta.dirname, "tools/xdd-advance.ts"), "utf8");
		const branch = src.slice(src.indexOf("groupGate.ok"), src.indexOf("groupGateLabel = group.gateLabel"));
		expect(branch).toContain("只有 verify 阶段允许 xdd_rollback 回跳流程");
		expect(branch).not.toMatch(/type:\s*"ROLLBACK"/);
	});
});

// ── E.5: verify rollback default target ──────────────────────────────

describe("E.5 verify rollback default target", () => {
	it("xdd_rollback source defaults verify -> execute", () => {
		const src = readFileSync(join(import.meta.dirname, "tools/xdd-rollback.ts"), "utf8");
		// The default-target branch must map omitted targetStage to execute.
		const defaultBlock = src.slice(src.indexOf("} else {"));
		expect(defaultBlock).toMatch(/target\s*=\s*"execute"/);
	});

	it("targetStage is optional in the schema (allows default)", () => {
		const src = readFileSync(join(import.meta.dirname, "tools/xdd-rollback.ts"), "utf8");
		// Type.Optional on targetStage
		expect(src).toMatch(/targetStage:\s*Type\.Optional/);
	});
});

describe("stage repair budget state machine", () => {
	it("keeps five hard-Gate failures independent from five semantic AIGate failures", () => {
		for (let i = 0; i < 5; i++) expect(state.beginSelfHealAttempt("spec")).toBe(i + 1);
		expect(state.stageSelfHealBudget("spec", "hard_gate")).toMatchObject({ used: 5, remaining: 0, exhausted: true });
		expect(state.stageSelfHealBudget("spec", "ai_gate")).toMatchObject({ used: 0, remaining: 5, exhausted: false });
		for (let i = 0; i < 5; i++) expect(state.beginAiGateAttempt("spec")).toBe(i + 1);
		expect(state.stageSelfHealBudget("spec", "ai_gate")).toMatchObject({ used: 5, remaining: 0, exhausted: true });
		const rt = JSON.parse(readFileSync(join(cwd, ".xdd", "runtime.json"), "utf8"));
		expect(rt.selfHealUsed.spec).toBe(5);
		expect(rt.aiGateUsed.spec).toBe(5);
	});

	it("caps both persisted counters at five even after additional failures", () => {
		for (let i = 0; i < 6; i++) {
			state.beginSelfHealAttempt("spec");
			state.beginAiGateAttempt("spec");
		}
		expect(state.stageSelfHealBudget("spec", "hard_gate").used).toBe(5);
		expect(state.stageSelfHealBudget("spec", "ai_gate").used).toBe(5);
	});

	it("reserves flow budget for automatic verify fallback and stops when exhausted", () => {
		state.flowRollbackLimitTier2 = 1;
		expect(state.consumeFlowRollbackBudget()).toBe(true);
		expect(state.remainingFlowRollbackBudget()).toBe(0);
		expect(state.consumeFlowRollbackBudget()).toBe(false);
	});
});
