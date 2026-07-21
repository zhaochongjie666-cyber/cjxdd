import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transition } from "./core/controller.ts";
import { executePiEffects } from "./adapters/pi-effects.ts";
import { pruneContextMessages, TEXT_CONTENT_STUB } from "./context-prune.ts";
import type { RuntimeStateV2 } from "./storage/runtime-migrations.ts";

const SRC_DIR = join(import.meta.dirname);

function read(rel: string): string {
	return readFileSync(join(SRC_DIR, rel), "utf8");
}

function runtimeState(): RuntimeStateV2 {
	return {
		schemaVersion: 4,
		runId: "run-pipeline-ai-reuse",
		cwd: "/tmp/project",
		userInput: "ship the feature",
		status: "running",
		planIndex: 0,
		plan: [{ stage: "init", originalIndex: 0 }],
		stageEpoch: "init:epoch:1",
		stageOutcome: "gate_passed",
		lastStageError: null,
		paused: false,
		stopRequested: false,
		runComplete: false,
		continuationQueued: false,
		continuationEpoch: 0,
		pendingGroupApproval: null,
		ledger: [],
		artifacts: {},
		submittedArtifacts: {},
		currentAttemptByStage: {},
		selfHealAttemptsByStage: {},
		maxSelfHealPerStage: 3,
		rollbackCount: 0,
		maxRollback: 3,
		groupCycles: {},
		maxGroupCycles: 2,
		archived: false,
		flowBudgetUsd: 5,
		flowCostUsd: 0,
		flowTokensUsed: 0,
		flowBudgetExhausted: false,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}

describe("Pipeline AI reuse for turn-loop context management", () => {
	it("Controller only requests compaction; the adapter delegates the actual compressor to Pi ctx.compact", async () => {
		const transitioned = transition(runtimeState(), { type: "AGENT_ENDED", stopReason: "stop", contextUsagePercent: 72 });
		expect(transitioned.effects).toHaveLength(1);
		expect(transitioned.effects[0]).toMatchObject({ type: "COMPACT" });
		expect(transitioned.state.continuationQueued).toBe(false);

		let compactOptions: any;
		await executePiEffects(transitioned.effects, {
			pi: {},
			ctx: {
				compact: (options) => {
					compactOptions = options;
				},
				ui: { notify: () => undefined },
			},
		});

		expect(compactOptions?.customInstructions).toContain("stageEpoch: init:epoch:1");
		expect(compactOptions?.customInstructions).toContain("Gate 失败原因");
		expect(typeof compactOptions?.onComplete).toBe("function");
		expect(typeof compactOptions?.onError).toBe("function");
	});

	it("uses Pi session_compact as a lifecycle completion signal instead of inventing a second completion channel", () => {
		const extension = read("extension.ts");
		const compactionHandler = extension.slice(extension.indexOf('pi.on("session_compact"'));

		expect(compactionHandler).toContain('pi.on("session_compact"');
		expect(compactionHandler).toContain('type: "COMPACTION_DONE"');
		expect(compactionHandler).not.toMatch(/summarizeConversation|summaryModel|createCompressor|customCompressor/);
	});

	it("context pruning stubs old oversized text but preserves the latest turn instead of semantic summarization", () => {
		const messages: any[] = [
			{ role: "user", content: "old".repeat(1_000) },
			{ role: "assistant", content: "old assistant".repeat(1_000) },
			{ role: "user", content: "current instruction must stay" },
		];

		const out = pruneContextMessages(messages, { currentTurnStartIndex: messages.length, maxTotalTextChars: 200 });
		expect(out[0].content).toBe(TEXT_CONTENT_STUB);
		expect(out[1].content).toBe(TEXT_CONTENT_STUB);
		expect(out[2].content).toBe("current instruction must stay");
	});

	it("documents the three-way boundary: Pi owns compaction, xdd owns safety pruning, failures route to Controller/Gate evidence", () => {
		const doc = read("../../Docs/pi-coding-agent-session-turn-loop.md");

		expect(doc).toContain("xdd **不实现自己的对话压缩器**");
		expect(doc).toContain("实际摘要/压缩由 Pi Pipeline AI 完成");
		expect(doc).toContain("XDD 失败应回到对应阶段/Gate/Controller 修");
	});
});
