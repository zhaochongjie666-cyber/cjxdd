import { describe, expect, it, vi } from "vitest";
import autoCompact, { compactBeforeInference, DEFAULT_AUTO_COMPACT_ENABLED, DEFAULT_AUTO_COMPACT_THRESHOLD, parseAutoCompactThreshold } from "./index.ts";

describe("auto compact configuration", () => {
	it("is disabled by default, retains a 90% opt-in threshold, and accepts percent syntax", () => {
		expect(DEFAULT_AUTO_COMPACT_ENABLED).toBe(false);
		expect(DEFAULT_AUTO_COMPACT_THRESHOLD).toBe(90);
		expect(parseAutoCompactThreshold("")).toBe("status");
		expect(parseAutoCompactThreshold("75%")).toBe(75);
		expect(parseAutoCompactThreshold("off")).toBe("off");
		expect(parseAutoCompactThreshold("0")).toBeNull();
		expect(parseAutoCompactThreshold("101")).toBeNull();
	});

	it("waits for Pi built-in compaction callback", async () => {
		let finish: (() => void) | undefined;
		const promise = compactBeforeInference({
			compact: ({ onComplete }: any) => { finish = onComplete; },
			getContextUsage: () => undefined,
			ui: {} as any,
		});
		let settled = false;
		void promise.then(() => { settled = true; });
		await Promise.resolve();
		expect(settled).toBe(false);
		finish?.();
		await promise;
		expect(settled).toBe(true);
	});

	it("does not compact ordinary conversations until a threshold is explicitly configured", async () => {
		const handlers: Record<string, Function> = {};
		let command: Function = () => undefined;
		const compact = vi.fn(({ onComplete }) => onComplete());
		const notify = vi.fn();
		autoCompact({
			registerCommand: (_name: string, spec: any) => { command = spec.handler; },
			on: (name: string, handler: Function) => { handlers[name] = handler; },
		} as any);
		const ctx = { getContextUsage: () => ({ percent: 89 }), compact, ui: { notify } };
		await handlers.before_agent_start({}, ctx);
		expect(compact).not.toHaveBeenCalled();
		ctx.getContextUsage = () => ({ percent: 100 });
		await handlers.before_agent_start({}, ctx);
		expect(compact).not.toHaveBeenCalled();

		await command("95", ctx);
		expect(notify).toHaveBeenCalledWith("[auto-compact] 已启用，推理前阈值为 95%", "info");
		ctx.getContextUsage = () => ({ percent: 94 });
		await handlers.before_agent_start({}, ctx);
		expect(compact).not.toHaveBeenCalled();
		ctx.getContextUsage = () => ({ percent: 95 });
		await handlers.before_agent_start({}, ctx);
		expect(compact).toHaveBeenCalledOnce();
	});

	it("reports compaction failure and leaves Pi overflow fallback available", async () => {
		const handlers: Record<string, Function> = {};
		const notify = vi.fn();
		let command: Function = () => undefined;
		autoCompact({ registerCommand: (_name: string, spec: any) => { command = spec.handler; }, on: (name: string, handler: Function) => { handlers[name] = handler; } } as any);
		await command("90", { ui: { notify } });
		await handlers.before_agent_start({}, {
			getContextUsage: () => ({ percent: 99 }),
			compact: ({ onError }: any) => onError(new Error("provider unavailable")),
			ui: { notify },
		});
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("上下文溢出机制兜底"), "warning");
	});
});
