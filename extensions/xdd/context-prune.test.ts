import { describe, expect, it } from "vitest";
import { EPOCH_MARKER_PREFIX, sliceByEpoch } from "./epoch-slicer.ts";
import { BASH_OUTPUT_STUB, TEXT_CONTENT_STUB, buildXddCompactionInstructions, pruneContextMessages } from "./context-prune.ts";

function user(text: string) { return { role: "user", content: text }; }
function assistant(text: string, extra: Record<string, unknown> = {}) { return { role: "assistant", content: text, ...extra }; }
function assistantTool(id: string, name = "bash") {
	return { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }] };
}
function tool(id: string, name: string, content: string) { return { role: "tool", tool_call_id: id, name, content }; }
function summary(text: string) { return { role: "compactionSummary", summary: text, tokensBefore: 123, timestamp: Date.now() }; }

describe("T10 context pruning", () => {
	it("stubs historical bash output while preserving tool call/result pairing", () => {
		const messages = [
			user("old"),
			assistantTool("call-bash-1"),
			tool("call-bash-1", "bash", "x".repeat(5_000)),
			assistant("done"),
			assistantTool("call-bash-2"),
			tool("call-bash-2", "bash", "current output".repeat(500)),
		];
		const out = pruneContextMessages(messages as any);
		expect(out).toHaveLength(messages.length);
		expect((out[1] as any).tool_calls[0].id).toBe("call-bash-1");
		expect((out[2] as any).tool_call_id).toBe("call-bash-1");
		expect((out[2] as any).content).toBe(BASH_OUTPUT_STUB);
		// Latest assistant tool call is the current turn; its result remains full.
		expect((out[5] as any).content).toContain("current output");
	});

	it("removes historical assistant thinking without touching normal content", () => {
		const out = pruneContextMessages([
			assistant("answer", { thinking: "hidden", content: [{ type: "thinking", text: "secret" }, { type: "text", text: "visible" }] }),
		] as any);
		expect((out[0] as any).thinking).toBeUndefined();
		expect((out[0] as any).content).toEqual([{ type: "text", text: "visible" }]);
	});

	it("combines epoch slicing, compaction summary, and pruning", () => {
		const epoch = "run:verify:1";
		const messages = [
			user("before"),
			user(`${EPOCH_MARKER_PREFIX} ${epoch}`),
			assistantTool("old-bash"),
			tool("old-bash", "bash", "y".repeat(5_000)),
			summary("compacted current stage"),
			assistant("post compact", { reasoning: "drop" }),
		];
		const sliced = sliceByEpoch(messages as any, epoch);
		expect(sliced[0].role).toBe("compactionSummary");
		const pruned = pruneContextMessages(sliced as any);
		expect((pruned[1] as any).reasoning).toBeUndefined();
		// The old bash pair was summarized away by epoch/compaction slicing.
		expect(pruned.some((message: any) => message.tool_call_id === "old-bash")).toBe(false);
	});

	it("caps total historical text while preserving the latest user instruction", () => {
		const messages = [
			user("old user " + "u".repeat(4_000)),
			assistant("old assistant " + "a".repeat(4_000)),
			user("latest instruction must stay"),
		];
		const out = pruneContextMessages(messages as any, { maxTotalTextChars: 1_000 });
		expect((out[0] as any).content).toBe(TEXT_CONTENT_STUB);
		expect((out[1] as any).content).toBe(TEXT_CONTENT_STUB);
		expect((out[2] as any).content).toBe("latest instruction must stay");
	});

	it("caps text without deleting tool call/result pairs", () => {
		const messages = [
			assistantTool("call-keep", "bash"),
			tool("call-keep", "bash", "z".repeat(4_000)),
			user("latest"),
		];
		const out = pruneContextMessages(messages as any, { currentTurnStartIndex: messages.length, maxTotalTextChars: 1_000 });
		expect((out[0] as any).tool_calls[0].id).toBe("call-keep");
		expect((out[1] as any).tool_call_id).toBe("call-keep");
		expect((out[1] as any).content).toBe(BASH_OUTPUT_STUB);
	});

	it("builds compaction instructions with stage, gate, modified files and harness guidance", () => {
		const text = buildXddCompactionInstructions({
			goal: "ship feature",
			stage: "verify",
			stageEpoch: "r:verify:0",
			modifiedFiles: ["src/a.ts"],
			lastGateError: "TRACE_GAP",
			unfinishedTasks: ["add evidence"],
			harnessChanges: ["验证命令: npm test"],
		});
		expect(text).toContain("当前阶段: verify");
		expect(text).toContain("src/a.ts");
		expect(text).toContain("TRACE_GAP");
		expect(text).toContain("Harness 变化");
		expect(text).toContain("tool_call 与 tool result 配对");
	});
});
