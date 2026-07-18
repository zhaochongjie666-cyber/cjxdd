import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocumentHandoffMessages, shouldUseDocumentHandoff } from "./context-document-handoff.ts";

function user(text: string) { return { role: "user", content: text }; }
function assistantTool(id: string) { return { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: "bash", arguments: "{}" } }] }; }
function tool(id: string, content: string) { return { role: "tool", tool_call_id: id, name: "bash", content }; }

describe("design document handoff context", () => {
	it("adds design-stage document inputs while preserving tool history and latest user message", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-doc-handoff-"));
		mkdirSync(join(cwd, ".xdd/design"), { recursive: true });
		writeFileSync(join(cwd, ".xdd/design/design.md"), "# Design\nSelected: document truth");
		const messages = [
			user("old request"),
			assistantTool("call-old"),
			tool("call-old", "very long shell output"),
			user("latest steering"),
		];

		const out = await buildDocumentHandoffMessages({
			cwd,
			stage: "spec",
			inputs: [{ pattern: ".xdd/design/design.md", required: true, description: "design" }],
			messages: messages as any,
		});

		expect(out).toHaveLength(messages.length + 1);
		expect((out[0] as any).content).toBe("old request");
		expect(out.some((message: any) => message.role === "tool")).toBe(true);
		expect(out.some((message: any) => message.tool_calls)).toBe(true);
		expect((out.at(-2) as any).content).toContain(".xdd/design/design.md");
		expect((out.at(-2) as any).content).toContain("Selected: document truth");
		expect((out.at(-1) as any).content).toBe("latest steering");
	});

	it("does not collapse implementation stages", async () => {
		const messages = [assistantTool("call-current"), tool("call-current", "test output")];
		const out = await buildDocumentHandoffMessages({ cwd: "/tmp", stage: "execute", messages: messages as any });
		expect(out).toBe(messages);
		expect(shouldUseDocumentHandoff("execute")).toBe(false);
	});
});
