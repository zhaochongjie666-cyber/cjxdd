import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import autoCompact, { DEFAULT_AUTO_COMPACT_THRESHOLD, parseAutoCompactThreshold, triggerCompaction } from "./index.ts";

function setup(percent = 0, cwd?: string) {
	const handlers: Record<string, Function> = {};
	const commands: Record<string, Function> = {};
	const tools: Record<string, any> = {};
	const compact = vi.fn(({ onComplete }) => onComplete());
	const notify = vi.fn();
	let currentPercent = percent;
	// Create a fake .xdd/runtime.json so hasActiveFlowRun returns true
	const testCwd = cwd ?? join(tmpdir(), `xdd-test-${randomBytes(6).toString("hex")}`);
	const runtimeDir = join(testCwd, ".xdd");
	mkdirSync(runtimeDir, { recursive: true });
	writeFileSync(join(runtimeDir, "runtime.json"), JSON.stringify({ status: "running" }));
	autoCompact({
		registerCommand: (name: string, spec: any) => { commands[name] = spec.handler; },
		registerTool: (spec: any) => { tools[spec.name] = spec; },
		on: (name: string, handler: Function) => { handlers[name] = handler; },
	} as any);
	const ctx = { cwd: testCwd, getContextUsage: () => ({ percent: currentPercent }), compact, ui: { notify }, hasUI: true };
	return { handlers, commands, tools, compact, notify, ctx, setPercent: (value: number) => { currentPercent = value; }, cleanup: () => { try { rmSync(runtimeDir, { recursive: true }); } catch {} } };
}

describe("auto compact configuration", () => {
	it("uses 90% by default and accepts percent syntax", () => {
		expect(DEFAULT_AUTO_COMPACT_THRESHOLD).toBe(90);
		expect(parseAutoCompactThreshold("")).toBe("status");
		expect(parseAutoCompactThreshold("75%")).toBe(75);
		expect(parseAutoCompactThreshold("off")).toBe("off");
		expect(parseAutoCompactThreshold("0")).toBeNull();
		expect(parseAutoCompactThreshold("101")).toBeNull();
	});

	it("waits for Pi's compaction callback and supplies preservation instructions", async () => {
		let options: any;
		const promise = triggerCompaction({ compact: (value: any) => { options = value; }, ui: {} as any });
		let settled = false;
		void promise.then(() => { settled = true; });
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(options.customInstructions).toContain("关键决策");
		options.onComplete();
		await promise;
	});

	it("compacts at agent_end when context usage reaches the configured limit", async () => {
		const harness = setup(89);
		await harness.handlers.agent_end({}, harness.ctx);
		expect(harness.compact).not.toHaveBeenCalled();
		harness.setPercent(90);
		await harness.handlers.agent_end({}, harness.ctx);
		expect(harness.compact).toHaveBeenCalledOnce();
		harness.setPercent(99);
		await harness.handlers.agent_end({}, harness.ctx);
		expect(harness.compact).toHaveBeenCalledOnce();
		harness.setPercent(20);
		await harness.handlers.agent_end({}, harness.ctx);
		harness.setPercent(90);
		await harness.handlers.agent_end({}, harness.ctx);
		expect(harness.compact).toHaveBeenCalledTimes(2);
	});

	it("supports manual compaction with custom instructions", async () => {
		const harness = setup();
		await harness.commands["trigger-compact"]("只保留架构决策", harness.ctx);
		expect(harness.compact).toHaveBeenCalledWith(expect.objectContaining({ customInstructions: "只保留架构决策" }));
	});

	it("reports callback failures without throwing into the turn loop", async () => {
		const harness = setup(89);
		harness.ctx.compact = vi.fn(({ onError }: any) => onError(new Error("provider unavailable")));
		await harness.handlers.agent_end({}, harness.ctx);
		harness.setPercent(90);
		await harness.handlers.agent_end({}, harness.ctx);
		expect(harness.notify).toHaveBeenCalledWith(expect.stringContaining("provider unavailable"), "warning");
	});
});
