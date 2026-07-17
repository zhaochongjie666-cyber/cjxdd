import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FakePiAdapterHarness } from "./pi-adapter-harness.ts";
import { EPOCH_MARKER_PREFIX } from "../epoch-slicer.ts";
import { BASH_OUTPUT_STUB } from "../context-prune.ts";
import { executePiEffects } from "../adapters/pi-effects.ts";

let harness: FakePiAdapterHarness;

function writeVerifyTraceGapFixture(cwd: string): void {
	mkdirSync(join(cwd, ".xdd", "runs", "iter-1", "plan", "task"), { recursive: true });
	mkdirSync(join(cwd, ".xdd", "runs", "iter-1", "evidence"), { recursive: true });
	mkdirSync(join(cwd, ".xdd", "design", "spec", "b01"), { recursive: true });
	writeFileSync(join(cwd, ".xdd", "runs", "iter-1", "plan", "task", "plan.md"), "- [x] done\n", "utf8");
	writeFileSync(join(cwd, ".xdd", "design", "spec", "b01", "rules.md"), "| ID | Rule |\n| R01 | rule |\n", "utf8");
	writeFileSync(join(cwd, ".xdd", "runs", "iter-1", "evidence", "runtime.txt"), "ok", "utf8");
	writeFileSync(
		join(cwd, ".xdd", "runs", "iter-1", "verify-report.md"),
		`# Verify Report\n\nRuntime evidence npm test exited 0. HTTP evidence curl GET /api/items returned status 200. Evidence .xdd/runs/iter-1/evidence/runtime.txt\n\n${"真实验证说明".repeat(80)}`,
		"utf8",
	);
}

function toolText(result: any): string {
	return result.content?.map((part: any) => part.text ?? "").join("\n") ?? "";
}

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
		harness.controller.submitGatePassed();
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
		harness.controller.startAdvancedAt("architecture");
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "stop" }],
		});
		expect(harness.state.continuationQueued).toBe(true);
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.text).toContain("已进入 architecture 阶段");
		expect(harness.sentMessages[0]?.text).toContain("xdd_difference");
	});


	it("hard Gate failure sends a steering message before the next LLM call", async () => {
		harness.state.stageOutcome = "hard_gate_failed";
		harness.state.lastStageError = "missing .xdd/design/intent.md";

		await harness.emit("tool_result", {
			type: "tool_result",
			toolName: "xdd_submit_artifact",
			content: [{ type: "text", text: "❌ [gate 1/5] init 未达标：missing .xdd/design/intent.md" }],
		});

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toMatchObject({
			text: expect.stringContaining("missing .xdd/design/intent.md"),
			options: { deliverAs: "steer" },
		});
	});

	it("AIGate failure does not masquerade as a hard-Gate steering message", async () => {
		harness.state.stageOutcome = "hard_gate_failed";
		harness.state.lastStageError = "semantic review failed";

		await harness.emit("tool_result", {
			type: "tool_result",
			toolName: "xdd_submit_artifact",
			content: [{ type: "text", text: "❌ [AIGate 1/5] init 多角度攻击未通过" }],
		});

		expect(harness.sentMessages).toHaveLength(0);
	});

	it("before_tools hook block rejects the tool call before execution", async () => {
		mkdirSync(join(harness.cwd, ".xdd", "hooks", "before_tools"), { recursive: true });
		writeFileSync(
			join(harness.cwd, ".xdd", "hooks", "before_tools", "01-block.js"),
			"process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ action: 'block', reason: 'project policy says no' })));",
			"utf8",
		);

		await expect(harness.emit("tool_call", { toolName: "bash", input: { command: "npm test" } }))
			.rejects.toThrow("project policy says no");
		expect(harness.sentMessages).toHaveLength(0);
	});

	it("shows the same structured verify failure in difference, submit, and status", async () => {
		writeVerifyTraceGapFixture(harness.cwd);
		harness.controller.startAt("verify");

		const { evaluateVerifyEvidenceGateFull } = await import("../evidence/verify-gate.ts");
		const failure = (await evaluateVerifyEvidenceGateFull(harness.cwd)).failure;
		expect(failure?.code).toBe("TRACE_GAP");
		expect(failure?.message).toContain("spec RXX");

		const difference = harness.tools.find((tool) => tool.name === "xdd_difference");
		const submit = harness.tools.find((tool) => tool.name === "xdd_submit_artifact");
		expect(difference).toBeTruthy();
		expect(submit).toBeTruthy();

		const diffText = toolText(await difference!.execute("diff-call", {}));
		expect(diffText).toContain(failure!.code);
		expect(diffText).toContain(failure!.message);

		const submitResult = await submit!.execute("submit-call", {
			summary: "verify trace gap fixture",
			artifacts: [],
			selfAttack: "checked trace consistency and found the expected gap",
			pass: false,
		});
		const submitText = toolText(submitResult);
		expect(submitText).toContain(failure!.code);
		expect(submitText).toContain(failure!.message);
		expect(submitText).toContain("本 turn 继续");
		expect(submitResult.terminate).toBeUndefined();
		expect(harness.state.lastStageError ?? "").toContain(failure!.code);
		expect(harness.state.lastStageError ?? "").toContain(failure!.message);

		await harness.command("xdd-status");
		const statusText = harness.sentMessages.at(-1)?.text ?? "";
		expect(statusText).toContain(failure!.code);
		expect(statusText).toContain(failure!.message);
		expect(statusText).toContain("Audit last gate");
	});


	it("context hook runs epoch slicing and safe pruning together", async () => {
		harness.state.stageEpoch = "harness:verify:1";
		const messages = [
			{ role: "user", content: "old stage" },
			{ role: "user", content: `${EPOCH_MARKER_PREFIX} harness:verify:1` },
			{ role: "assistant", content: "", tool_calls: [{ id: "old-bash", type: "function", function: { name: "bash", arguments: "{}" } }] },
			{ role: "tool", tool_call_id: "old-bash", name: "bash", content: "x".repeat(5_000) },
			{ role: "assistant", content: [{ type: "thinking", text: "drop" }, { type: "text", text: "keep" }] },
			{ role: "assistant", content: "", tool_calls: [{ id: "current-bash", type: "function", function: { name: "bash", arguments: "{}" } }] },
			{ role: "tool", tool_call_id: "current-bash", name: "bash", content: "current".repeat(800) },
		];
		const [result] = await harness.emit("context", { messages });
		expect(result.messages).toHaveLength(6);
		expect(result.messages[0].content).toContain(EPOCH_MARKER_PREFIX);
		expect(result.messages[2].tool_call_id).toBe("old-bash");
		expect(result.messages[2].content).toBe(BASH_OUTPUT_STUB);
		expect(result.messages[3].content).toEqual([{ type: "text", text: "keep" }]);
		expect(result.messages[5].content).toContain("current");
	});

	it("waits for Pi's compaction callback before queuing the continuation", async () => {
		let compactOptions: any;
		harness.contextUsage = { percent: 0.72 };
		harness.ctx.compact = (options: any) => {
			harness.compactCalls.push(options);
			compactOptions = options;
		};
		harness.controller.submitGatePassed();

		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "stop" }],
		});
		expect(harness.compactCalls).toHaveLength(1);
		expect(harness.compactCalls[0]?.customInstructions).toContain("当前阶段");
		expect(harness.sentMessages).toHaveLength(0);

		compactOptions.onComplete({});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.text).toContain("xdd_advance");
	});

	it("high context usage compacts before sending a single continuation", async () => {
		harness.contextUsage = { percent: 0.72 };
		harness.controller.submitGatePassed();
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "stop" }],
		});
		expect(harness.compactCalls).toHaveLength(1);
		expect(harness.compactCalls[0].customInstructions).toContain("当前阶段");
		expect(harness.compactCalls[0].customInstructions).toContain("tool_call 与 tool result 配对");
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.text).toContain("xdd_advance");
		expect(harness.state.continuationQueued).toBe(true);
	});


	it("session_compact completion resumes through one controller continuation", async () => {
		harness.controller.submitGatePassed();
		await harness.emit("session_compact", { success: true });
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.text).toContain("xdd_advance");
		expect(harness.state.continuationQueued).toBe(true);

		await harness.emit("session_compact", { success: true });
		expect(harness.sentMessages).toHaveLength(1);
	});

	it("compaction failure releases back to a single continuation instead of stalling", async () => {
		harness.contextUsage = { percent: 0.9 };
		harness.controller.submitGatePassed();
		harness.ctx.compact = () => { throw new Error("compactor unavailable"); };

		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "stop" }],
		});

		expect(harness.notifications.at(-1)?.message).toContain("compaction 失败");
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.text).toContain("xdd_advance");
		expect(harness.state.continuationQueued).toBe(true);

		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "stop" }],
		});
		expect(harness.sentMessages).toHaveLength(1);
	});


	it("effect failure is visible in xdd-status audit view", async () => {
		await executePiEffects([{ type: "NOTIFY", level: "info", text: "boom" }], {
			getState: () => harness.state,
			pi: {},
			ctx: { ui: { notify: () => { throw new Error("notify closed"); } } },
		}).catch(() => undefined);

		await harness.command("xdd-status");
		const statusText = harness.sentMessages.at(-1)?.text ?? "";
		expect(statusText).toContain("Audit last finding");
		expect(statusText).toContain("effect failed: NOTIFY");
		expect(statusText).toContain("notify closed");
	});

	it("hook block result is visible in xdd-status audit view", async () => {
		mkdirSync(join(harness.cwd, ".xdd", "hooks", "before_tools"), { recursive: true });
		writeFileSync(
			join(harness.cwd, ".xdd", "hooks", "before_tools", "01-block.js"),
			"process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ action: 'block', reason: 'audit visible' })));",
			"utf8",
		);
		await expect(harness.emit("tool_call", { toolName: "bash", input: { command: "npm test" } }))
			.rejects.toThrow("audit visible");

		await harness.command("xdd-status");
		const statusText = harness.sentMessages.at(-1)?.text ?? "";
		expect(statusText).toContain("Audit last finding");
		expect(statusText).toContain("hook before_tools: block");
	});

	it("hard-Gate steering is asynchronous and does not release the followUp lock", async () => {
		harness.state.continuationQueued = true;
		const handlers = harness.handlers.get("input") ?? [];
		expect(handlers).toHaveLength(1);

		const resultPromise = handlers[0]?.({
			source: "extension",
			text: "[xdd hard-gate steering] repair the artifact",
		}, harness.ctx);
		expect(resultPromise).toBeInstanceOf(Promise);
		expect(await resultPromise).toEqual({ action: "continue" });
		expect(harness.state.continuationQueued).toBe(true);

		harness.state.paused = true;
		const [pausedResult] = await harness.emit("input", {
			source: "extension",
			text: "[xdd hard-gate steering] repair the artifact",
		});
		expect(pausedResult).toEqual({ action: "handled" });
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
