import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildForkContext, renderForkContext } from "../fork-context.ts";
import { findXddSubagent } from "../registry.ts";
import type { XddSubagentRunRecord } from "../runtime-store.ts";

function makeRun(cwd: string): XddSubagentRunRecord {
	return {
		id: "run-fork",
		mode: "single",
		status: "queued",
		agents: ["xdd-scout"],
		tasks: ["侦察"],
		cwd,
		createdAt: "2026-07-18T00:00:00.000Z",
		updatedAt: "2026-07-18T00:00:00.000Z",
		artifactDir: join(cwd, ".xdd", "subagents", "artifacts", "run-fork"),
		transcriptPath: join(cwd, ".xdd", "subagents", "artifacts", "run-fork", "run.log"),
		results: [],
	};
}

describe("xdd subagent fork context", () => {
	it("inherits AGENTS.md instructions and safety rules", () => {
		const root = mkdtempSync(join(tmpdir(), "xdd-fork-context-"));
		try {
			const child = join(root, "packages", "app");
			mkdirSync(child, { recursive: true });
			writeFileSync(join(root, "AGENTS.md"), "root instruction");
			writeFileSync(join(child, "AGENTS.md"), "child instruction");
			const agent = findXddSubagent("xdd-scout");
			expect(agent).toBeTruthy();
			const context = buildForkContext(child, makeRun(child), agent!);
			expect(context.instructions.map((entry) => entry.text)).toEqual(["root instruction", "child instruction"]);
			const rendered = renderForkContext(context);
			expect(rendered).toContain("Inherited Parent Context");
			expect(rendered).toContain("不要写 current_project/.pi");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
