import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XddController } from "../xdd/core/controller.ts";
import { activateNormalFlowExtension, deactivateNormalFlowExtension, normalFlowInlineExtension } from "./extension.ts";
import { createNormalFlowRuntimeStore, NORMAL_FLOW_RUNTIME_FILE, NORMAL_FLOW_V1_BACKUP_FILE } from "./runtime-store.ts";
import { NF_STAGES } from "./stages.ts";
import { XddRunnerState } from "./types.ts";

type Handler = (event?: any, ctx?: any) => unknown;

const cleanups: Array<() => void> = [];

afterEach(() => {
	deactivateNormalFlowExtension();
	while (cleanups.length > 0) cleanups.pop()?.();
});

function createHarness() {
	const cwd = mkdtempSync(join(tmpdir(), "normal-flow-provider-"));
	cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
	const runId = "nf-provider-test";
	new XddController(createNormalFlowRuntimeStore(cwd), NF_STAGES).dispatch({
		type: "START",
		task: "exercise provider lifecycle",
		options: { cwd, runId },
	});
	const state = new XddRunnerState({
		runId,
		cwd,
		userInput: "exercise provider lifecycle",
		runtimeStoreOptions: {
			runtimeFileName: NORMAL_FLOW_RUNTIME_FILE,
			legacyCheckpointFileName: false,
			v1BackupFileName: NORMAL_FLOW_V1_BACKUP_FILE,
		},
	});
	state.plan = NF_STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	activateNormalFlowExtension(state);

	const handlers = new Map<string, Handler[]>();
	const notifications: string[] = [];
	const pi = {
		registerCommand: () => undefined,
		registerTool: () => undefined,
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		sendUserMessage: async () => undefined,
	};
	normalFlowInlineExtension.factory(pi as never);
	const ctx = {
		ui: { notify: (message: string) => notifications.push(message) },
		hasPendingMessages: () => false,
		isIdle: () => true,
	};
	const emit = async (name: string, event: unknown = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	return { emit, notifications, state };
}

describe("Normal Flow provider lifecycle", () => {
	it("keeps a provider error transient until Pi settles", async () => {
		const harness = createHarness();
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "error", errorMessage: "504 Gateway Time-out" }],
		});

		expect(harness.state.paused).toBe(false);
		expect(harness.state.stageOutcome).toBe("idle");
		expect(harness.notifications).toHaveLength(0);

		await harness.emit("agent_settled");
		expect(harness.state.paused).toBe(true);
		expect(harness.state.stageOutcome).toBe("provider_error");
		expect(harness.notifications).toHaveLength(1);
	});

	it("discards a transient error when Pi retry succeeds", async () => {
		const harness = createHarness();
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "error", errorMessage: "terminated" }],
		});
		await harness.emit("agent_end", {
			messages: [{ role: "assistant", stopReason: "stop" }],
		});
		await harness.emit("agent_settled");

		expect(harness.state.paused).toBe(false);
		expect(harness.state.stageOutcome).not.toBe("provider_error");
		expect(harness.notifications).toHaveLength(0);
	});
});
