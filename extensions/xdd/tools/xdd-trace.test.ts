import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES } from "../stages.ts";
import { XddRunnerState } from "../types.ts";
import { createXddTraceTool } from "./xdd-trace.ts";

function makeState(cwd: string): XddRunnerState {
	const state = new XddRunnerState({ runId: "trace-test", cwd, userInput: "u" });
	state.plan = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	state.startRun();
	return state;
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
	return result.content[0].text;
}

describe("xdd_trace tool", () => {
	it("returns no-active-run message when no stage is current", async () => {
		const state = new XddRunnerState({ runId: "t", cwd: "/tmp", userInput: "u" });
		const tool = createXddTraceTool(() => state);
		const result = await tool.execute("", {});
		expect(textOf(result as never)).toContain("无活跃 run");
	});

	it("reports unimplemented spec RXX and orphan code markers from disk", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-trace-"));
		try {
			const specDir = join(dir, ".xdd", "design", "spec", "B01");
			mkdirSync(specDir, { recursive: true });
			writeFileSync(join(specDir, "rules.md"), "| R01 |\n| R02 |\n| R03 |\n");
			writeFileSync(join(specDir, "r01.feature"), "Feature");
			// R01 + R02 implemented; R04 is an orphan.
			writeFileSync(join(dir, "app.py"), "# @implements R01\n# @implements R02\n# @implements R04\n");

			const state = makeState(dir);
			const tool = createXddTraceTool(() => state);
			const result = await tool.execute("", {});
			const text = textOf(result as never);
			expect(text).toContain("追溯链覆盖");
			expect(text).toContain("spec RXX: 3 条");
			expect(text).toContain("代码 @implements: 3 个 RXX");
			expect(text).toContain("未实现（spec 有、代码无 @implements）: R03");
			expect(text).toContain("孤儿标注（代码有 @implements、spec 无对应 RXX）: R04");
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("reports complete trace when spec and code line up", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-trace-"));
		try {
			const specDir = join(dir, ".xdd", "design", "spec", "B01");
			mkdirSync(specDir, { recursive: true });
			writeFileSync(join(specDir, "rules.md"), "| R01 |\n| R02 |\n");
			writeFileSync(join(dir, "app.py"), "# @implements R01\n# @implements R02\n");

			const state = makeState(dir);
			const tool = createXddTraceTool(() => state);
			const result = await tool.execute("", {});
			const text = textOf(result as never);
			expect(text).toContain("追溯链完整：spec RXX 与代码 @implements 一一对应");
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});
