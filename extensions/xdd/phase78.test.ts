/**
 * Phase 7 (G) + Phase 8 (H) regression tests.
 *
 *   G.1  bash tool default timeout 300s + SIGTERM via pi's killProcessTree
 *   G.2  forbidden bash patterns (find /, rm -rf /, etc.) blocked
 *   G.3  bash timeout / error recorded into ESG
 *
 *   H.1  xdd_next_task uses computeStageDifference (not artifacts-only)
 *   H.2  sendUserMessage failures surfaced via ui.notify (not silent)
 *   H.3  Stage summary uses shared glob resolver
 *   H.4  production /xdd and E2E share the same state machine (smoke)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = join(import.meta.dirname);

// ── G.1 + G.2: bash tool_call handler ─────────────────────────────────

describe("G.1 bash tool default timeout", () => {
	it("extension registers tool_call handler with timeout injection", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		expect(src).toMatch(/pi\.on\("tool_call"/);
		// Must inject timeout when missing
		expect(src).toMatch(/input\.timeout\s*=\s*300/);
	});

	it("tool_call handler returns quickly (sync mutation)", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		// The tool_call handler for bash should not await -- it mutates
		// event.input in place (per pi's ToolCallEventResult contract).
		// Slice from "tool_call" (the ON registration) to "xdd uses
		// per-stage context slicing" (the next comment block).
		const start = src.indexOf('pi.on("tool_call"');
		const end = src.indexOf("xdd uses per-stage context slicing", start);
		const block = src.slice(start, end);
		expect(block).not.toMatch(/await\s+pi\.sendUserMessage/);
	});
});

describe("G.2 forbidden bash patterns", () => {
	it("forbids find / at root (no path prefix)", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		// The literal regex source `\\bfind\\s+\\/\\s*(?!-)` must appear
		// (escaped for the JS source string).
		expect(src).toContain("\\bfind\\s+\\/\\s*(?!-)");
	});

	it("forbids find /<args> with -flag form", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		expect(src).toContain("\\bfind\\s+\\/\\s*-");
	});

	it("forbids rm to root filesystem", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		expect(src).toContain("rm\\s+(-[a-zA-Z]*\\s+)*\\/\\s*");
	});

	it("forbids dd to devices", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		expect(src).toContain("dd\\s+if=\\/dev\\/");
	});

	it("forbids mkfs to devices", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		expect(src).toContain("mkfs(\\.\\w+)?\\s+\\/dev\\/");
	});

	it("forbidden check throws (not soft-fails)", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		const start = src.indexOf("forbidden");
		const end = src.indexOf("tool_result", start);
		const block = src.slice(start, end);
		expect(block).toMatch(/throw new Error/);
	});
});

// ── G.3: bash telemetry into ESG ─────────────────────────────────────

describe("G.3 bash telemetry into ESG", () => {
	it("tool_result handler records exit / timeout / error", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		expect(src).toMatch(/pi\.on\("tool_result"/);
		expect(src).toMatch(/recordEsgNode/);
		expect(src).toMatch(/timeout:\\d\+/);
		expect(src).toMatch(/bash (timeout|failed):/);
	});
});

// ── H.1: xdd_next_task uses computeStageDifference ────────────────────

describe("H.1 xdd_next_task uses computeStageDifference", () => {
	it("calls computeStageDifference (not artifacts-only)", () => {
		const src = readFileSync(join(SRC_DIR, "tools/xdd-next-task.ts"), "utf8");
		expect(src).toMatch(/computeStageDifference/);
		expect(src).toMatch(/renderStageDifference/);
	});

	it("action decision is gated on diff.gate.ok, not artifacts.length", () => {
		const src = readFileSync(join(SRC_DIR, "tools/xdd-next-task.ts"), "utf8");
		// Old code: `if (artifacts.length === 0) ...`. New code: branches
		// on diff.gate.ok / diff.unmetCount / remaining.
		expect(src).toMatch(/diff\.gate\.ok/);
		expect(src).toMatch(/diff\.unmetCount/);
	});

	it("renders objective, concrete tasks, and completion criteria to avoid next-task loops", () => {
		const src = readFileSync(join(SRC_DIR, "tools/xdd-next-task.ts"), "utf8");
		expect(src).toContain("目标: ${objective}");
		expect(src).toContain("具体任务:");
		expect(src).toContain("完成标准:");
		expect(src).toContain("完成后调用 xdd_submit_artifact 提交产物与证据");
		expect(src).toContain("不要再调用 xdd_observe 或 xdd_next_task 做二次确认");
		expect(src).toContain("避免 observe/next_task 空转循环");
	});

	it("xdd_observe explicitly blocks observe/next_task ping-pong", () => {
		const src = readFileSync(join(SRC_DIR, "tools/xdd-observe.ts"), "utf8");
		expect(src).toContain("[防循环指令]");
		expect(src).toContain("不要把 observe 后的默认下一步设为 xdd_next_task");
	});
});

// ── H.2: sendUserMessage failures surfaced ────────────────────────────

describe("H.2 sendUserMessage failures not silently swallowed", () => {
	it("agent_end compact block: sendUserMessage has catch handler", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		// Locate the ctx.compact({...}) call and find its matching `})`
		// by counting braces from the start (handles nested lambdas).
		const start = src.indexOf("ctx.compact({");
		let depth = 0;
		let end = start;
		for (let i = start; i < src.length; i++) {
			if (src[i] === "{") depth++;
			else if (src[i] === "}") {
				depth--;
				if (depth === 0) { end = i + 1; break; }
			}
		}
		const compactBlock = src.slice(start, end);
		expect(compactBlock).toMatch(/\.catch\s*\(\s*\(/);
		expect(compactBlock).toMatch(/ctx\.ui\.notify/);
	});

	it("ui.notify messages in compact block >= 2 (onComplete + onError)", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		const start = src.indexOf("ctx.compact({");
		let depth = 0;
		let end = start;
		for (let i = start; i < src.length; i++) {
			if (src[i] === "{") depth++;
			else if (src[i] === "}") {
				depth--;
				if (depth === 0) { end = i + 1; break; }
			}
		}
		const compactBlock = src.slice(start, end);
		const matches = compactBlock.match(/ctx\.ui\.notify/g) ?? [];
		expect(matches.length).toBeGreaterThanOrEqual(2);
	});
});

// ── H.3: buildStageSummary uses glob-resolver ─────────────────────────

describe("H.3 stage summary uses glob resolver", () => {
	it("buildStageSummary calls resolveGlobs", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		expect(src).toMatch(/function buildStageSummary/);
		expect(src).toMatch(/resolveGlobs\(cwd,\s*stage\.deliverablePaths\)/);
	});

	it("glob patterns are not false-missing", () => {
		const src = readFileSync(join(SRC_DIR, "extension.ts"), "utf8");
		// The summary should handle glob patterns (not just literal paths).
		// Look for the hasGlobMeta check + "no files match" branch.
		expect(src).toMatch(/hasGlobMeta\(p\)/);
		expect(src).toMatch(/no files match/);
	});
});

// ── H.4: production/test share state machine ──────────────────────────

describe("H.4 production /xdd and E2E share controller core", () => {
	it("E2E imports the headless adapter backed by XddController", () => {
		const e2eSrc = readFileSync(join(SRC_DIR, "runner.e2e.test.ts"), "utf8");
		const headlessSrc = readFileSync(join(SRC_DIR, "adapters/headless-controller.ts"), "utf8");
		expect(e2eSrc).toMatch(/HeadlessXddController/);
		expect(headlessSrc).toMatch(/new XddController/);
	});

	it("production and headless tests both route through Controller dispatch", () => {
		const e2eSrc = readFileSync(join(SRC_DIR, "runner.e2e.test.ts"), "utf8");
		const runSrc = readFileSync(join(SRC_DIR, "run.ts"), "utf8");
		expect(e2eSrc).toMatch(/\.dispatch\(\{ type: "START"/);
		expect(runSrc).toMatch(/controller\.dispatch\(\{/);
		expect(runSrc).toMatch(/type:\s*"START"/);
		expect(runSrc).toMatch(/activateXddExtension/);
	});
});
