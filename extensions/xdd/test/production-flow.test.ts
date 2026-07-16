import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakePiAdapterHarness } from "./pi-adapter-harness.ts";

let harness: FakePiAdapterHarness;

beforeEach(() => {
	harness = new FakePiAdapterHarness();
});

afterEach(() => {
	harness.dispose();
});

describe("production pi adapter lifecycle", () => {
	it("five /xdd-stop commands notify once and send zero model turns", async () => {
		harness.idle = false;
		for (let i = 0; i < 5; i++) {
			await harness.command("xdd-stop");
		}
		expect(harness.state.paused).toBe(true);
		expect(harness.state.stopRequested).toBe(true);
		expect(harness.aborted).toBe(true);
		expect(harness.notifications).toHaveLength(1);
		expect(harness.sentMessages).toHaveLength(0);
	});

	it("provider error followed by compaction does not create xdd followUp", async () => {
		harness.contextUsage = { percent: 0.95 };
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "error", errorMessage: "rate limit" }],
		});
		expect(harness.state.stageOutcome).toBe("provider_error");
		expect(harness.state.lastStageError).toBe("rate limit");
		expect(harness.compactCalls).toHaveLength(0);
		expect(harness.sentMessages).toHaveLength(0);
	});

	it("normal agent_end queues exactly one continuation", async () => {
		harness.state.stageOutcome = "gate_passed";
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "stop" }],
		});
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "stop" }],
		});
		expect(harness.state.continuationQueued).toBe(true);
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.text).toContain("xdd_advance");
	});

	it("advanced agent_end starts the next stage instead of idling", async () => {
		harness.state.stageOutcome = "advanced";
		harness.state.planIndex = 2; // architecture
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "stop" }],
		});
		expect(harness.state.continuationQueued).toBe(true);
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.text).toContain("已进入 architecture 阶段");
		expect(harness.sentMessages[0]?.text).toContain("xdd_difference");
	});

	it("stale queued continuation is dropped while paused and lock clears after resume delivery", async () => {
		harness.state.continuationQueued = true;
		harness.state.paused = true;
		const [pausedResult] = await harness.emit("input", {
			source: "extension",
			text: "[xdd 自动推进] 继续 spec。",
		});
		expect(pausedResult).toEqual({ action: "handled" });
		expect(harness.state.continuationQueued).toBe(true);

		harness.state.paused = false;
		const [resumedResult] = await harness.emit("input", {
			source: "extension",
			text: "[xdd 自动推进] 继续 spec。",
		});
		expect(resumedResult).toEqual({ action: "continue" });
		expect(harness.state.continuationQueued).toBe(false);
	});
});
