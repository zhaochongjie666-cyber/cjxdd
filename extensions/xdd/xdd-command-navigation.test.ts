import { describe, expect, it } from "vitest";
import { FakePiAdapterHarness } from "./test/pi-adapter-harness.ts";

describe("/xdd control subcommands", () => {
	it("go to jumps to a named stage and only displays status", async () => {
		const harness = new FakePiAdapterHarness();
		try {
			await harness.command("xdd", "go to execute");
			expect(harness.state.currentStageName()).toBe("execute");
			expect(harness.state.status).toBe("running");
			expect(harness.sentMessages).toHaveLength(0);
			expect(harness.notifications.at(-1)?.message).toContain("跳转到 execute 阶段 (8/10)");
		} finally {
			harness.dispose();
		}
	});

	it("rejects an unknown stage without changing state or steering", async () => {
		const harness = new FakePiAdapterHarness();
		try {
			await harness.command("xdd", "go to nowhere");
			expect(harness.state.currentStageName()).toBe("init");
			expect(harness.sentMessages).toHaveLength(0);
			expect(harness.notifications.at(-1)?.message).toContain("未知阶段");
			expect(harness.notifications.at(-1)?.message).toContain("verify");
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
