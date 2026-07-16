import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiControllerAdapter, agentEndCommandFromPi, rollbackCommandFromTool, submitCommandFromTool } from "./pi-controller.ts";
import { STAGES } from "../stages.ts";
import { XddRunnerState } from "../types.ts";

let cwd = "";
let state: XddRunnerState;
let sent: Array<{ text: string; options?: unknown }>;
let notified: Array<{ text: string; level?: string }>;
let aborted = false;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "xdd-pi-controller-"));
	state = new XddRunnerState({ runId: "adapter", cwd, userInput: "task" });
	state.plan = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	state.startRun();
	sent = [];
	notified = [];
	aborted = false;
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function adapter(idle = false): PiControllerAdapter {
	return new PiControllerAdapter({
		getState: () => state,
		pi: { sendUserMessage: async (text: string, options?: unknown) => { sent.push({ text, options }); } },
		ctx: {
			isIdle: () => idle,
			abort: () => { aborted = true; },
			ui: { notify: (text: string, level?: string) => { notified.push({ text, level }); } },
			hasPendingMessages: () => false,
		},
	});
}

describe("PiControllerAdapter", () => {
	it("dispatches STOP through Controller and executes abort/notify effects", async () => {
		await adapter(false).dispatch({ type: "STOP", source: "command" });
		expect(state.paused).toBe(true);
		expect(aborted).toBe(true);
		expect(notified).toHaveLength(1);
		expect(sent).toHaveLength(0);
	});

	it("does not send stale followUp effects when continuation epoch has changed", async () => {
		state.continuationEpoch = 2;
		state.stageOutcome = "gate_passed";
		await adapter().dispatch({ type: "AGENT_ENDED", stopReason: "stop" });
		expect(sent[0]?.text).toContain("xdd_advance");
		expect(sent[0]?.options).toEqual({ deliverAs: "followUp" });
	});

	it("maps pi agent_end and tool payloads to Controller commands", () => {
		expect(agentEndCommandFromPi({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "rate" }] })).toEqual({
			type: "AGENT_ENDED",
			stopReason: "error",
			providerError: "rate",
		});
		expect(submitCommandFromTool({ summary: "s", artifacts: [], selfAttack: "specific risk note", pass: true })).toMatchObject({ type: "SUBMIT" });
		expect(rollbackCommandFromTool("spec", "bad architecture")).toEqual({ type: "ROLLBACK", target: "spec", reason: "bad architecture" });
	});
});
