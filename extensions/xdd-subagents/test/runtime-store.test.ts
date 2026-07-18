import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRuntimeState, XddSubagentRunStore } from "../runtime-store.ts";

describe("xdd subagent runtime store hardening", () => {
	it("normalizes missing or malformed runtime state", () => {
		expect(normalizeRuntimeState(null)).toEqual({ schemaVersion: 1, runs: [] });
		expect(normalizeRuntimeState({ schemaVersion: 999, runs: "bad" })).toEqual({ schemaVersion: 1, runs: [] });
	});

	it("backs up corrupt runtime files instead of crashing", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-runtime-corrupt-"));
		try {
			const store = new XddSubagentRunStore(cwd);
			mkdirSync(join(cwd, ".xdd", "subagents"), { recursive: true });
			writeFileSync(store.filePath, "{not-json");
			expect(store.load()).toEqual({ schemaVersion: 1, runs: [] });
			expect(readdirSync(join(cwd, ".xdd", "subagents")).some((file) => file.includes("runs.json.corrupt."))).toBe(true);
			expect(existsSync(store.filePath)).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
