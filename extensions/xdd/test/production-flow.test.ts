import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FakePiAdapterHarness } from "./pi-adapter-harness.ts";
import { EPOCH_MARKER_PREFIX } from "../epoch-slicer.ts";
import { BASH_OUTPUT_STUB } from "../context-prune.ts";
import { executePiEffects } from "../adapters/pi-effects.ts";

let harness: FakePiAdapterHarness;

function writeVerifyTraceGapFixture(cwd: string): void {
	mkdirSync(join(cwd, ".xdd", "runs", "xdd_run", "plan", "task"), { recursive: true });
	mkdirSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence"), { recursive: true });
	mkdirSync(join(cwd, ".xdd", "design", "spec", "b01"), { recursive: true });
	writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "plan", "task", "plan.md"), "- [x] done\n", "utf8");
	writeFileSync(join(cwd, ".xdd", "design", "spec", "b01", "rules.md"), "| ID | Rule |\n| R01 | rule |\n", "utf8");
	writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "evidence", "runtime.txt"), "ok", "utf8");
	writeFileSync(
		join(cwd, ".xdd", "runs", "xdd_run", "verify-report.md"),
		`# Verify Report\n\nRuntime evidence npm test exited 0. HTTP evidence curl GET /api/items returned status 200. Evidence .xdd/runs/xdd_run/evidence/runtime.txt\n\n${"真实验证说明".repeat(80)}`,
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

	it("/xdd-resume appends its input to the continuation steering", async () => {
		await harness.command("xdd-stop");
		await harness.command("xdd-resume", "请注意使用node");

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toMatchObject({
			text: "[xdd 自动推进] 恢复 init 阶段。请调 xdd_next_task 继续。\n\n请注意使用node",
			options: { deliverAs: "followUp" },
		});
	});

	it("provider error followed by compaction does not create xdd followUp and shows Pi retry ownership", async () => {
		harness.contextUsage = { percent: 95 };
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "error", errorMessage: "rate limit" }],
		});
		expect(harness.state.stageOutcome).toBe("provider_error");
		expect(harness.state.lastStageError).toBe("rate limit");
		expect(harness.compactCalls).toHaveLength(0);
		expect(harness.sentMessages).toHaveLength(0);
		expect(harness.notifications.at(-1)?.message).toContain("等待 Pi 内建重试");
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

	it("xdd_advance tool result steers the same turn to execute the next stage", async () => {
		harness.controller.submitGatePassed();
		const advance = harness.tools.find((tool) => tool.name === "xdd_advance");
		expect(advance).toBeDefined();

		const result = await advance.execute("advance", {});
		expect(toolText(result)).toContain("进入下一阶段 understand");
		await harness.emit("tool_result", {
			type: "tool_result",
			toolName: "xdd_advance",
			content: result.content,
		});

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toMatchObject({
			text: expect.stringContaining("已进入 understand 阶段"),
			options: { deliverAs: "steer" },
		});
		expect(harness.sentMessages[0]?.text).toContain("xdd_observe");
	});


	it("repairable unified AIGate failure steers the next model call to fix artifacts", async () => {
		harness.state.stageOutcome = "hard_gate_failed";
		harness.state.lastStageError = "semantic review failed";

		await harness.emit("tool_result", {
			type: "tool_result",
			toolName: "xdd_submit_artifact",
			content: [{ type: "text", text: "❌ [AIGate 1/5] init 多角度攻击未通过" }],
		});

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toMatchObject({
			text: expect.stringContaining("semantic review failed"),
			options: { deliverAs: "steer" },
		});
	});

	it("degraded AIGate infrastructure failure steers a bounded retry instead of idling", async () => {
		harness.state.lastStageError = "[AIGate LLM 调用失败] LLM API 504";
		harness.state.beginAiGateAttempt("init");

		await harness.emit("tool_result", {
			type: "tool_result",
			toolName: "xdd_submit_artifact",
			content: [{ type: "text", text: "⚠️ [AIGate degraded 1/5] init 审查服务/响应格式异常（基础设施故障）：\n本 turn 继续。请恢复审查服务或模型配置后重新调用 xdd_submit_artifact；无需修改产物。" }],
		});

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toMatchObject({
			text: expect.stringContaining("立即重新调用 xdd_submit_artifact"),
			options: { deliverAs: "steer" },
		});
		expect(harness.sentMessages[0]?.text).toContain("[xdd aigate steering]");
		expect(harness.sentMessages[0]?.text).toContain("不要停在等待状态");
	});

	it("exhausted AIGate failure does not steer because it must diagnose or roll back", async () => {
		harness.state.stageOutcome = "hard_gate_failed";
		harness.state.lastStageError = "semantic review failed";
		for (let i = 0; i < harness.state.maxSelfHealPerStage; i++) {
			harness.state.beginAiGateAttempt("init");
		}

		await harness.emit("tool_result", {
			type: "tool_result",
			toolName: "xdd_submit_artifact",
			content: [{ type: "text", text: "❌ [AIGate 5/5] init 多角度攻击未通过（自愈预算耗尽）" }],
		});

		expect(harness.sentMessages).toHaveLength(0);
	});

	it("group Gate automatic rollbacks use the Controller limit", async () => {
		const advance = harness.tools.find((tool) => tool.name === "xdd_advance");
		expect(advance).toBeDefined();
		harness.state.maxRollbacksPerStage = 2;

		for (let attempt = 1; attempt <= 2; attempt++) {
			harness.state.planIndex = 2; // spec: end of the discovery group
			harness.state.recordSignal("complete");
			const result = await advance.execute("group-gate", {});
			expect(toolText(result)).toContain("强制回退 spec -> init");
			expect(harness.state.rollbackAttempts.init).toBe(attempt);
		}

		harness.state.planIndex = 2;
		harness.state.recordSignal("complete");
		await expect(advance.execute("group-gate-limit", {})).rejects.toThrow(/ROLLBACK_LIMIT_REACHED|reached its limit/);
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

	it("uses all five verify self-heal attempts before spending one flow rollback", async () => {
		writeVerifyTraceGapFixture(harness.cwd);
		harness.controller.startAt("verify");
		const submit = harness.tools.find((tool) => tool.name === "xdd_submit_artifact");
		expect(submit).toBeTruthy();

		for (let attempt = 1; attempt <= 4; attempt++) {
			const result = await submit!.execute(`verify-retry-${attempt}`, {
				summary: `verify trace gap retry ${attempt}`,
				artifacts: [],
				selfAttack: `checked trace consistency on retry ${attempt} and found the expected gap`,
				pass: false,
			});
			expect(result.terminate).toBeUndefined();
			expect(harness.state.currentStageName()).toBe("verify");
			expect(harness.state.flowRollbackCount).toBe(0);
		}

		const exhausted = await submit!.execute("verify-retry-5", {
			summary: "verify trace gap retry 5",
			artifacts: [],
			selfAttack: "checked trace consistency on retry 5 and found the expected gap",
			pass: false,
		});
		expect(exhausted.terminate).toBeUndefined();
		expect(harness.state.currentStageName()).toBe("spec");
		expect(harness.state.flowRollbackCount).toBe(1);
	});


	it("context hook preserves epoch history while applying safe pruning", async () => {
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
		expect(result.messages).toHaveLength(7);
		expect(result.messages[0].content).toBe("old stage");
		expect(result.messages[1].content).toContain(EPOCH_MARKER_PREFIX);
		expect(result.messages[3].tool_call_id).toBe("old-bash");
		expect(result.messages[3].content).toBe(BASH_OUTPUT_STUB);
		expect(result.messages[4].content).toEqual([{ type: "text", text: "keep" }]);
		expect(result.messages[6].content).toContain("current");
	});

	it("leaves compaction to Pi and queues the continuation directly", async () => {
		harness.contextUsage = { percent: 72 };
		harness.controller.submitGatePassed();

		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "stop" }],
		});
		expect(harness.compactCalls).toHaveLength(0);
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.text).toContain("xdd_advance");
	});

	it("high context usage does not start a competing xdd compaction", async () => {
		harness.contextUsage = { percent: 72 };
		harness.controller.submitGatePassed();
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "stop" }],
		});
		expect(harness.compactCalls).toHaveLength(0);
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
		harness.contextUsage = { percent: 90 };
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

	it("drops queued degraded AIGate steering while paused", async () => {
		harness.state.paused = true;
		const [pausedResult] = await harness.emit("input", {
			source: "extension",
			text: "[xdd aigate steering] degraded init 阶段 AIGate 基础设施不可用：upstream 504。立即重新调用 xdd_submit_artifact。",
		});

		expect(pausedResult).toEqual({ action: "handled" });
	});
});
