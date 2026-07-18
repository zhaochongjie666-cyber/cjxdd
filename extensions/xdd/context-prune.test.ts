import { describe, expect, it } from "vitest";
import { EPOCH_MARKER_PREFIX, sliceByEpoch } from "./epoch-slicer.ts";
import { BASH_OUTPUT_STUB, TEXT_CONTENT_STUB, TOOL_OUTPUT_STUB, buildXddCompactionInstructions, pruneContextMessages } from "./context-prune.ts";

function user(text: string) { return { role: "user", content: text }; }
function assistant(text: string, extra: Record<string, unknown> = {}) { return { role: "assistant", content: text, ...extra }; }
function assistantTool(id: string, name = "bash") {
	return { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }] };
}
function anthropicAssistantTool(id: string, name = "bash", text = "I will run it.") {
	return { role: "assistant", content: [{ type: "text", text }, { type: "tool_use", id, name, input: {} }] };
}
function anthropicToolResult(id: string, text: string) {
	return { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] };
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

	it("stubs oversized historical read output while preserving the tool call id", () => {
		const messages = [
			assistantTool("call-read-1", "read"),
			tool("call-read-1", "read", "file output".repeat(500)),
			assistantTool("call-current", "bash"),
			tool("call-current", "bash", "current output"),
		];
		const out = pruneContextMessages(messages as any);

		expect((out[1] as any).role).toBe("tool");
		expect((out[1] as any).tool_call_id).toBe("call-read-1");
		expect((out[1] as any).content).toBe(TOOL_OUTPUT_STUB);
		expect((out[3] as any).content).toBe("current output");
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

	it("does not perform semantic text pruning by default because Pi owns compaction", () => {
		const messages = [
			user("old user " + "u".repeat(4_000)),
			assistant("old assistant " + "a".repeat(4_000)),
			user("latest instruction must stay"),
		];
		const out = pruneContextMessages(messages as any);

		expect(out).toBe(messages);
		expect((out[0] as any).content).toContain("old user");
		expect((out[1] as any).content).toContain("old assistant");
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

	it("caps text without deleting Anthropic content tool_use/tool_result pairs", () => {
		const messages = [
			user("old " + "u".repeat(4_000)),
			anthropicAssistantTool("call-anthropic", "bash", "a".repeat(4_000)),
			anthropicToolResult("call-anthropic", "r".repeat(4_000)),
			user("latest"),
		];
		const out = pruneContextMessages(messages as any, { currentTurnStartIndex: messages.length, maxTotalTextChars: 1_000 });

		expect((out[1] as any).content).toContainEqual({ type: "tool_use", id: "call-anthropic", name: "bash", input: {} });
		expect((out[2] as any).content).toContainEqual({ type: "tool_result", tool_use_id: "call-anthropic", content: "r".repeat(4_000) });
	});

	it("preserves all OpenAI tool results for one assistant with multiple tool calls", () => {
		const messages = [
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{ id: "call-one", type: "function", function: { name: "bash", arguments: "{}" } },
					{ id: "call-two", type: "function", function: { name: "xdd_difference", arguments: "{}" } },
				],
			},
			tool("call-one", "bash", "first output"),
			tool("call-two", "xdd_difference", "second output"),
			user("latest"),
		];

		const out = pruneContextMessages(messages as any, { currentTurnStartIndex: messages.length });

		expect((out[1] as any).role).toBe("tool");
		expect((out[1] as any).tool_call_id).toBe("call-one");
		expect((out[2] as any).role).toBe("tool");
		expect((out[2] as any).tool_call_id).toBe("call-two");
	});

	it("neutralizes a tool message when Pi tail trim kept the assistant text but dropped tool_calls", () => {
		const messages = [
			assistant("I will read the file, but the serialized tool_calls array was trimmed away."),
			tool("call-trimmed-away", "read", "file content from an orphaned read result"),
			user("latest"),
		];
		const out = pruneContextMessages(messages as any, { currentTurnStartIndex: messages.length });

		expect((out[1] as any).role).toBe("user");
		expect((out[1] as any).content[0].text).toContain("file content from an orphaned read result");
		expect((out[1] as any).content[0].text).toContain("缺少相邻 tool_use");
	});

	it("neutralizes a content tool_result when the preceding assistant kept text but lost tool_use", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "thinking/text survived but tool_use was trimmed" }] },
			anthropicToolResult("call-content-trimmed-away", "orphaned content result"),
			user("latest"),
		];
		const out = pruneContextMessages(messages as any, { currentTurnStartIndex: messages.length });

		expect((out[1] as any).content).toEqual([{
			type: "text",
			text: expect.stringContaining("orphaned content result"),
		}]);
		expect((out[1] as any).content[0].text).toContain("缺少相邻 tool_use");
	});

	it("neutralizes OpenAI-style tool messages when their adjacent tool call was sliced away", () => {
		const messages = [
			user("current epoch starts after the tool call"),
			tool("call-orphan-openai", "bash", "orphaned openai output"),
			user("latest"),
		];
		const out = pruneContextMessages(messages as any, { currentTurnStartIndex: messages.length });

		expect((out[1] as any).role).toBe("user");
		expect((out[1] as any).content).toEqual([{
			type: "text",
			text: expect.stringContaining("orphaned openai output"),
		}]);
		expect((out[1] as any).content[0].text).toContain("缺少相邻 tool_use");
	});

	it("neutralizes Anthropic tool_result blocks when their adjacent tool_use was sliced away", () => {
		const messages = [
			user("current epoch starts after the tool_use"),
			anthropicToolResult("call-orphan", "orphaned output"),
			user("latest"),
		];
		const out = pruneContextMessages(messages as any, { currentTurnStartIndex: messages.length });

		expect((out[1] as any).content).toEqual([{
			type: "text",
			text: expect.stringContaining("orphaned output"),
		}]);
		expect((out[1] as any).content[0].text).toContain("缺少相邻 tool_use");
	});

	it("normalizes valid Anthropic tool_result camelCase ids to provider snake_case", () => {
		const messages = [
			anthropicAssistantTool("call-valid-camel"),
			{ role: "user", content: [{ type: "tool_result", toolUseId: "call-valid-camel", content: "valid camel" }] },
		];
		const out = pruneContextMessages(messages as any, { currentTurnStartIndex: messages.length });

		expect((out[1] as any).content).toContainEqual({ type: "tool_result", tool_use_id: "call-valid-camel", content: "valid camel" });
		expect((out[1] as any).content[0]).not.toHaveProperty("toolUseId");
	});

	it("neutralizes Anthropic tool_result blocks that use camelCase ids when their adjacent tool_use is missing", () => {
		const messages = [
			user("current epoch starts after the tool_use"),
			{ role: "user", content: [{ type: "tool_result", toolUseId: "call-orphan-camel", content: "camel orphan" }] },
			user("latest"),
		];
		const out = pruneContextMessages(messages as any, { currentTurnStartIndex: messages.length });

		expect((out[1] as any).content).toEqual([{
			type: "text",
			text: expect.stringContaining("camel orphan"),
		}]);
		expect((out[1] as any).content[0].text).toContain("缺少相邻 tool_use");
	});

	it("neutralizes only orphan Anthropic tool_result blocks without dropping valid sibling results", () => {
		const messages = [
			anthropicAssistantTool("call-valid"),
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "call-valid", content: "valid output" },
					{ type: "tool_result", tool_use_id: "call-orphan", content: "orphaned output" },
				],
			},
			user("latest"),
		];
		const out = pruneContextMessages(messages as any, { currentTurnStartIndex: messages.length });

		expect((out[1] as any).content).toContainEqual({ type: "tool_result", tool_use_id: "call-valid", content: "valid output" });
		expect((out[1] as any).content).not.toContainEqual({ type: "tool_result", tool_use_id: "call-orphan", content: "orphaned output" });
		expect((out[1] as any).content.at(-1)).toEqual({
			type: "text",
			text: expect.stringContaining("orphaned output"),
		});
	});

	it("detects Anthropic content tool_use as the current turn boundary", () => {
		const messages = [
			anthropicAssistantTool("call-current"),
			anthropicToolResult("call-current", "current output".repeat(500)),
		];
		const out = pruneContextMessages(messages as any);

		expect((out[1] as any).content[0].content).toContain("current output");
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
