import { afterEach, describe, expect, it, vi } from "vitest";
import { startAIGateProgress } from "./aigate-progress.ts";

afterEach(() => {
	vi.useRealTimers();
});

describe("AIGate progress notifications", () => {
	it("shows start, periodic progress, and completion as UI-only info", () => {
		vi.useFakeTimers();
		let now = 1_000;
		const notifications: Array<{ message: string; level: string }> = [];
		const finish = startAIGateProgress(
			{ notify: (message, level) => notifications.push({ message, level }) },
			"spec",
			() => now,
			30_000,
		);

		expect(notifications).toEqual([
			{ message: expect.stringContaining("spec：AIGate 正在进行"), level: "info" },
		]);

		now += 30_000;
		vi.advanceTimersByTime(30_000);
		expect(notifications[1]).toEqual({ message: expect.stringContaining("已等待 30 秒"), level: "info" });

		now += 2_000;
		finish();
		expect(notifications[2]).toEqual({ message: expect.stringContaining("耗时 32 秒"), level: "info" });

		vi.advanceTimersByTime(60_000);
		expect(notifications).toHaveLength(3);
	});

	it("is a no-op when Pi UI is unavailable", () => {
		expect(() => startAIGateProgress(undefined, "verify")()).not.toThrow();
	});
});
