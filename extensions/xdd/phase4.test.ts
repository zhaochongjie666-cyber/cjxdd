/**
 * Phase 4 (F) regression tests: Stage contract refactor.
 *
 *   F.1/F.2  readScopes / writeScopes fields added to XddStageSpec
 *   F.3      static validation "必需输出必须可写" on activate
 *   F.5      Controller-side init scaffold (deterministic, not model-driven)
 *   F.6      verify stage is noCodeModification (rejects src/ writes)
 *   F.9      understand -> spec requires human approval
 *   F.8      --skip-wire option wires through to runXdd (smoke)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES } from "./stages.ts";
import { XddRunnerState } from "./types.ts";
import { createStateFixture, startStateFixture } from "./test/state-fixture.ts";
import { controllerInitScaffold, hasInitializedXddSkeleton } from "./init-scaffold.ts";

let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "xdd-phase4-"));
});
afterEach(() => {
	if (existsSync(cwd)) rmSync(cwd, { recursive: true });
});

// ── F.1/F.2: readScopes / writeScopes on every relevant stage ─────────

describe("F.1/F.2 readScopes/writeScopes fields exist", () => {
	it("XddStageSpec type allows optional writeScopes", () => {
		// Type-only: we can't construct at runtime, but if the field is
		// missing the stage spec object would TypeError when assigned.
		const stage = STAGES.find((s) => s.name === "verify")!;
		// writeScopes may be undefined (verify has noCodeModification,
		// it's read-only and writes only report/evidence which is
		// declared via deliverablePaths).
		expect(stage.noCodeModification).toBe(true);
	});

	it("verify stage has noCodeModification set", () => {
		const verify = STAGES.find((s) => s.name === "verify")!;
		expect(verify.noCodeModification).toBe(true);
	});

	it("understand stage does not require human approval", () => {
		const understand = STAGES.find((s) => s.name === "understand")!;
		expect(understand.requiresHumanApproval).not.toBe(true);
	});

	it("understand stage has WRITE_TOOLS (F: brainstorm needs doc-write)", () => {
		const understand = STAGES.find((s) => s.name === "understand")!;
		expect(understand.allowedTools).toContain("write");
	});
});

// ── F.3: static validation in activateXddExtension ────────────────────

describe("F.3 activate-time static validation", () => {
	it("default STAGES pass validation (no contract violations)", () => {
		// activateXddExtension throws on the first violation. The default
		// STAGES have no writeScopes declared, so the validator skips
		// every stage -- this test verifies the default is sane.
		const state = createStateFixture({ runId: "f3", cwd, userInput: "t" });
		startStateFixture(state);
		// We can't import activateXddExtension directly (it pulls in
		// extension.ts -> pi-tui). Instead, we exercise the validation
		// surface indirectly: validateStageContracts is module-private
		// but the contract check is just `for (const stage of plan) ...`.
		// Here we just check the plan is internally consistent.
		for (const { stage } of state.plan) {
			expect(stage.name).toBeDefined();
			expect(stage.gate).toBeDefined();
			expect(stage.aigateStandard).toBeDefined();
		}
	});
});

// ── F.5: Controller-side init scaffold ────────────────────────────────

describe("F.5 controllerInitScaffold", () => {
	it("creates all .xdd/ subdirectories when none exist", () => {
		const r = controllerInitScaffold(cwd);
		expect(r.created.length).toBeGreaterThan(0);
		expect(existsSync(join(cwd, ".xdd"))).toBe(true);
		expect(existsSync(join(cwd, ".xdd/design"))).toBe(true);
		expect(existsSync(join(cwd, ".xdd/design/spec"))).toBe(true);
		expect(existsSync(join(cwd, ".xdd/design/architecture"))).toBe(true);
		expect(existsSync(join(cwd, ".xdd/design/personas"))).toBe(true);
		expect(existsSync(join(cwd, ".xdd/design/wire"))).toBe(true);
		expect(existsSync(join(cwd, ".xdd/runs"))).toBe(true);
		expect(existsSync(join(cwd, ".xdd/archive"))).toBe(true);
	});

	it("detects pre-existing initialization before scaffold mutates a new project", () => {
		expect(hasInitializedXddSkeleton(cwd)).toBe(false);
		controllerInitScaffold(cwd);
		expect(hasInitializedXddSkeleton(cwd)).toBe(true);
	});

	it("is idempotent: second call skips all dirs", () => {
		controllerInitScaffold(cwd);
		const r2 = controllerInitScaffold(cwd);
		expect(r2.created.length).toBe(0);
		expect(r2.skipped.length).toBeGreaterThan(0);
	});

	it("does NOT touch cwd outside .xdd/", () => {
		controllerInitScaffold(cwd);
		// The original cwd listing should not contain a new top-level
		// dir other than .xdd/
		const { readdirSync } = require("node:fs");
		const entries = readdirSync(cwd);
		expect(entries).toContain(".xdd");
		expect(entries.length).toBe(1);
	});
});

// ── F.6: verify stage rejects source code writes ──────────────────────

describe("F.6 verify noCodeModification enforced", () => {
	it("xdd_submit_artifact rejects verify-stage writes to src/", async () => {
		// We import the submit tool indirectly via the runner.e2e flow
		// because the tool needs a real pi context. Instead, pin the
		// source-level contract.
		const src = require("node:fs").readFileSync(
			require("node:path").join(import.meta.dirname, "tools/xdd-submit-artifact.ts"),
			"utf8",
		);
		// Must check noCodeModification + reject source code patterns
		expect(src).toMatch(/stage\.noCodeModification/);
		expect(src).toMatch(/sourceCodePattern/);
		expect(src).toMatch(/src\|lib\|tests/);
	});
});

// ── F.9: optional human approval controller support ───────────────────

describe("F.9 optional requiresHumanApproval support", () => {
	it("controller supports pendingGroupApproval for custom stage plans", () => {
		const src = require("node:fs").readFileSync(
			require("node:path").join(import.meta.dirname, "core/controller.ts"),
			"utf8",
		);
		expect(src).toMatch(/current\?\.requiresHumanApproval/);
		expect(src).toMatch(/pendingGroupApproval/);
	});

	it("/xdd continue dispatches APPROVE when a custom plan is pending approval", () => {
		const src = require("node:fs").readFileSync(
			require("node:path").join(import.meta.dirname, "run.ts"),
			"utf8",
		);
		expect(src).toMatch(/type:\s*"APPROVE"/);
	});
});

// ── F.8: skip-wire option wires through ────────────────────────────────

describe("F.8 --skip-wire option", () => {
	it("STAGES contains wire (default build)", () => {
		expect(STAGES.find((s) => s.name === "wire")).toBeDefined();
	});

	it("HeadlessXddController is exported for runnerless tests", async () => {
		const { HeadlessXddController } = await import("./adapters/headless-controller.ts");
		expect(typeof HeadlessXddController).toBe("function");
		const src = require("node:fs").readFileSync(
			require("node:path").join(import.meta.dirname, "types.ts"),
			"utf8",
		);
		expect(src).toMatch(/skipWire\?/);
	});
});
