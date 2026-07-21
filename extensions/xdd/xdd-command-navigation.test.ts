import { describe, expect, it } from "vitest";
import { FakePiAdapterHarness } from "./test/pi-adapter-harness.ts";

describe("xdd lifecycle commands", () => {
	it("a stage-specific goto command jumps without requiring arguments or steering", async () => {
		const harness = new FakePiAdapterHarness();
		try {
			await harness.command("xdd-goto-plan");
			expect(harness.state.currentStageName()).toBe("plan");
			await harness.command("xdd-goto-execute");
			expect(harness.state.currentStageName()).toBe("execute");
			expect(harness.state.status).toBe("running");
			expect(harness.sentMessages).toHaveLength(0);
			expect(harness.notifications.at(-1)?.message).toContain("跳转到 execute 阶段 (8/10)");
		} finally {
			harness.dispose();
		}
	});

	it("does not register unknown stage commands", async () => {
		const harness = new FakePiAdapterHarness();
		try {
			await expect(harness.command("xdd-goto-nowhere")).rejects.toThrow("command not registered");
			expect(harness.state.currentStageName()).toBe("init");
			expect(harness.sentMessages).toHaveLength(0);
			expect(harness.notifications).toHaveLength(0);
		} finally {
			harness.dispose();
		}
	});

	it("status and reset display state without submitting steer messages", async () => {
		const harness = new FakePiAdapterHarness();
		try {
			await harness.command("xdd", "status");
			expect(harness.notifications.at(-1)?.message).toContain("阶段 init (1/10)");
			await harness.command("xdd", "reset all");
			expect(harness.notifications.at(-1)?.message).toContain("当前阶段: init (1/10)");
			expect(harness.notifications.at(-1)?.message).toContain("流程状态: running");
			expect(harness.sentMessages).toHaveLength(0);
		} finally {
			harness.dispose();
		}
	});
});
