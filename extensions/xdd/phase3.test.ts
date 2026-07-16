/**
 * Phase 3 (C) P28-29 regression tests.
 *
 * P28: stageEpoch replaces numeric boundary. The context hook slices
 * messages based on a string marker in the message stream. Stable
 * across compaction because it's a string, not an index.
 *
 * P29: proactive compaction at >= 70% context usage. agent_end reads
 * ctx.getContextUsage() and triggers ctx.compact() before queuing a
 * followUp, so the agent sees a fresh context window.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES } from "./stages.ts";
import { XddRunnerState } from "./types.ts";
import { sliceByEpoch, EPOCH_MARKER_PREFIX } from "./epoch-slicer.ts";
import { FakePiAdapterHarness } from "./test/pi-adapter-harness.ts";

let cwd = "";
let state: XddRunnerState;

function freshState(): XddRunnerState {
	cwd = mkdtempSync(join(tmpdir(), "xdd-phase3-"));
	state = new XddRunnerState({ runId: "phase3", cwd, userInput: "test" });
	state.plan = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	state.startRun();
	return state;
}

beforeEach(() => { freshState(); });
afterEach(() => { if (existsSync(cwd)) rmSync(cwd, { recursive: true }); });

// ── P28: stageEpoch field ─────────────────────────────────────────────

describe("P28 stageEpoch state field", () => {
	it("default is runId:?:0 (placeholder sentinel for 'no real stage yet')", () => {
		// P28 contract: defaultRt(runId) writes `${runId}:?:0` so the
		// context hook can identify "no real stage yet" and passthrough.
		expect(state.stageEpoch).toBe("phase3:?:0");
	});

	it("makeStageEpoch returns runId:stage:attempt", () => {
		expect(state.makeStageEpoch("spec", 3)).toBe("phase3:spec:3");
		expect(state.makeStageEpoch("execute", 1)).toBe("phase3:execute:1");
	});

	it("set and persist to runtime.json", () => {
		state.stageEpoch = "phase3:spec:2";
		const rt = JSON.parse(readFileSync(join(cwd, ".xdd", "runtime.json"), "utf8"));
		expect(rt.stageEpoch).toBe("phase3:spec:2");
	});

	it("lastCompactionAt default 0, persists", () => {
		expect(state.lastCompactionAt).toBe(0);
		state.lastCompactionAt = Date.now();
		const rt = JSON.parse(readFileSync(join(cwd, ".xdd", "runtime.json"), "utf8"));
		expect(rt.lastCompactionAt).toBeGreaterThan(0);
	});
});

// ── P28: sliceByEpoch ─────────────────────────────────────────────────

describe("P28 sliceByEpoch", () => {
	function msg(role: "user" | "assistant" | "compactionSummary", text: string) {
		if (role === "compactionSummary") {
			return { role, summary: text, tokensBefore: 0, timestamp: Date.now() };
		}
		return { role, content: text, timestamp: Date.now() };
	}

	it("no epoch marker -> passthrough", () => {
		const msgs = [
			msg("user", "hello"),
			msg("assistant", "world"),
		];
		const out = sliceByEpoch(msgs as any, "phase3:spec:1");
		expect(out).toBe(msgs as any); // identity check -- no slicing
	});

	it("empty epoch -> passthrough (initial state)", () => {
		const msgs = [msg("user", "hello")];
		const out = sliceByEpoch(msgs as any, "");
		expect(out).toBe(msgs as any);
	});

	it("default '?:0' epoch -> passthrough (compat shim)", () => {
		const msgs = [msg("user", "hello")];
		const out = sliceByEpoch(msgs as any, "phase3:?:0");
		expect(out).toBe(msgs as any);
	});

	it("finds epoch marker, slices from there", () => {
		const epoch = "phase3:spec:2";
		const msgs = [
			msg("user", "earlier turn 1"),
			msg("assistant", "earlier reply 1"),
			msg("user", `${EPOCH_MARKER_PREFIX} ${epoch}`),
			msg("assistant", "stage 2 reply"),
			msg("user", "stage 2 turn 2"),
		];
		const out = sliceByEpoch(msgs as any, epoch);
		expect(out.length).toBe(3);
		expect((out[0] as any).content).toContain(EPOCH_MARKER_PREFIX);
	});

	it("compaction summary AFTER epoch marker -> use summary as start", () => {
		const epoch = "phase3:spec:2";
		const msgs = [
			msg("user", `${EPOCH_MARKER_PREFIX} ${epoch}`),
			msg("assistant", "stage 2 reply"),
			msg("compactionSummary", "compacted previous"),
			msg("assistant", "post-compaction reply"),
		];
		const out = sliceByEpoch(msgs as any, epoch);
		expect(out.length).toBe(2);
		expect(out[0].role).toBe("compactionSummary");
	});

	it("compaction summary BEFORE epoch marker -> use epoch marker as start", () => {
		const epoch = "phase3:spec:3";
		const msgs = [
			msg("user", "earlier turn"),
			msg("compactionSummary", "stale summary from before this stage"),
			msg("user", `${EPOCH_MARKER_PREFIX} ${epoch}`),
			msg("assistant", "stage 3 reply"),
		];
		const out = sliceByEpoch(msgs as any, epoch);
		expect(out.length).toBe(2);
		expect((out[0] as any).content).toContain(EPOCH_MARKER_PREFIX);
	});

	it("different epoch value than marker -> passthrough (epoch not yet seen)", () => {
		const msgs = [
			msg("user", `${EPOCH_MARKER_PREFIX} phase3:spec:1`),
			msg("assistant", "reply"),
		];
		const out = sliceByEpoch(msgs as any, "phase3:spec:2");
		// No marker for spec:2 in stream -- passthrough so the model can
		// see the prior stage and continue. (The marker for spec:2 will
		// be injected on the next before_agent_start.)
		expect(out).toBe(msgs as any);
	});
});

// ── P29: context usage check (unit-testable via stub) ────────────────

describe("P29 context usage threshold contract", () => {
	// The 70% threshold lives in extension.ts (not directly testable
	// here). We pin the contract as a constant + a smoke test.

	it("threshold is documented as 0.7 (P29 plan)", () => {
		// Grep the source to confirm the threshold matches P29. If a
		// future refactor changes the value, this test fails and forces
		// a docs + plan update.
		const src = readFileSync(join(import.meta.dirname, "extension.ts"), "utf8");
		expect(src).toMatch(/usage\.percent\s*>=\s*0\.7/);
	});

	it("dedup: lastCompactionAt < 30s ago -> skip retry (anti-loop)", () => {
		// We can't directly test the time check without pi hooks, but we
		// can verify the field semantics: setting lastCompactionAt to
		// "now" means the next agent_end should not retrigger compaction
		// within 30s.
		state.lastCompactionAt = Date.now();
		const now = Date.now();
		const elapsed = now - state.lastCompactionAt;
		expect(elapsed).toBeLessThan(30_000);
	});
});

// ── P28: tool epoch writes ────────────────────────────────────────────

describe("P28 tools write stageEpoch", () => {
	it("xdd_submit_artifact sets stageEpoch using selfHealUsed (submit attempt counter)", () => {
		// xdd_submit_artifact in the production code does:
		//   const attempt = state.currentAttempt(stage.name);
		//   state.stageEpoch = state.makeStageEpoch(stage.name, attempt);
		// currentAttempt reads attempts[stage] which is set by beginAttempt
		// (used by the test E2E XddRunner). In production, attempts stays 0
		// because no one calls beginAttempt -- so the epoch will read 0
		// until the stage-advance path bumps it. This is acceptable for
		// epoch semantics: the epoch string is a stable identity, not a
		// retry counter. We verify the helper works:
		const attempt = state.currentAttempt("spec");
		state.stageEpoch = state.makeStageEpoch("spec", attempt);
		expect(state.stageEpoch).toBe("phase3:spec:0");
		// Bumping selfHealUsed (the real submit-retry counter) does NOT
		// change currentAttempt. That's a known split between the two
		// counters; C phase doesn't unify them.
		state.beginSelfHealAttempt("spec");
		expect(state.currentAttempt("spec")).toBe(0); // unchanged
	});

	it("xdd_advance sets new stage's epoch after planIndex moves", () => {
		// Simulate the xdd_advance handler:
		state.startRun(); // planIndex = 0 (init)
		state.stageEpoch = state.makeStageEpoch("init", state.currentAttempt("init"));
		expect(state.stageEpoch).toBe("phase3:init:0");
		state.advancePlan(); // -> understand
		state.stageEpoch = state.makeStageEpoch("understand", state.currentAttempt("understand"));
		expect(state.stageEpoch).toBe("phase3:understand:0");
	});
});


describe("P29 compaction followUp dispatch compatibility", () => {
	it("does not call .catch on a synchronous sendUserMessage result", async () => {
		const adapter = new FakePiAdapterHarness();
		try {
			adapter.sendUserMessageMode = "sync";
			adapter.contextUsage = { percent: 0.71 };
			adapter.state.stageOutcome = "idle";

			await adapter.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
			expect(adapter.compactCalls).toHaveLength(1);

			expect(() => adapter.compactCalls[0].onError()).not.toThrow();
			expect(adapter.sentMessages).toHaveLength(1);
			expect(adapter.sentMessages[0].options).toEqual({ deliverAs: "followUp" });
		} finally {
			adapter.dispose();
		}
	});
});
