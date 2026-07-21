import { describe, expect, it, vi } from "vitest";
import autoCompact, { DEFAULT_AUTO_COMPACT_THRESHOLD, isXddStageEnd, parseAutoCompactThreshold, triggerCompaction } from "./index.ts";

function setup(percent = 0) {
	const handlers: Record<string, Function> = {};
	const commands: Record<string, Function> = {};
	const compact = vi.fn(({ onComplete }) => onComplete());
	const notify = vi.fn();
	let currentPercent = percent;
	autoCompact({
		registerCommand: (name: string, spec: any) => { commands[name] = spec.handler; },
		on: (name: string, handler: Function) => { handlers[name] = handler; },
	} as any);
	const ctx = { getContextUsage: () => ({ percent: currentPercent }), compact, ui: { notify }, hasUI: true };
	return { handlers, commands, compact, notify, ctx, setPercent: (value: number) => { currentPercent = value; } };
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

	it("compacts at a successful xdd stage end, not at turn_end", async () => {
		const harness = setup(89);
		expect(harness.handlers.turn_end).toBeUndefined();
		await harness.handlers.tool_result({
			type: "tool_result",
			toolName: "xdd_advance",
			content: [{ type: "text", text: "[xdd_advance] spec 通过，进入下一阶段 architecture。" }],
		}, harness.ctx);
		expect(harness.compact).toHaveBeenCalledOnce();
		await harness.handlers.tool_result({
			type: "tool_result",
			toolName: "xdd_advance",
			isError: true,
			content: [{ type: "text", text: "[xdd_advance] failed" }],
		}, harness.ctx);
		expect(harness.compact).toHaveBeenCalledOnce();
	});

	it("recognizes successful next, approval, and final stage boundaries", () => {
		const event = (text: string) => ({ toolName: "xdd_advance", content: [{ type: "text", text }] });
		expect(isXddStageEnd(event("[xdd_advance] init 通过，进入下一阶段 understand。"))).toBe(true);
		expect(isXddStageEnd(event("[xdd_advance] spec 阶段完成，需要人类确认后才能进 architecture。"))).toBe(true);
		expect(isXddStageEnd(event("[xdd_advance] 最终阶段 verify 通过，xdd run 完成 ✅。"))).toBe(true);
		expect(isXddStageEnd(event("[xdd_advance] 当前阶段尚未声明完成"))).toBe(false);
	});

	it("compacts at agent_end when a long stage reaches the configured limit", async () => {
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
