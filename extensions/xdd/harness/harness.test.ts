import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeHarness, conciseHarness } from "./schema.ts";
import { HarnessStore, parseHarnessYaml, serializeHarnessYaml } from "./store.ts";
import { probeHarnessFacts } from "./probe.ts";
import { requireTestsPass } from "../gate.ts";

describe("xdd harness", () => {
	it("normalizes duplicates and truncates long working memory", () => {
		const long = "x".repeat(220);
		const h = normalizeHarness({ 工作记忆: [long, long], 验证命令: ["npm test", "npm test"] });
		expect(h.工作记忆).toHaveLength(1);
		expect(h.工作记忆[0].length).toBe(180);
		expect(h.验证命令).toEqual(["npm test"]);
	});

	it("round trips deterministic yaml", () => {
		const h = normalizeHarness({ 环境: { node: "v24" }, 项目: { runtime: "node" }, 验证命令: ["npm test"] });
		expect(parseHarnessYaml(serializeHarnessYaml(h))).toMatchObject(h);
	});

	it("updates harness atomically through the store", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-harness-"));
		try {
			const store = new HarnessStore(cwd);
			store.update("验证命令", "append", ["npm test", "npm test"]);
			store.update("工作记忆", "append", "Use local vitest binary when available");
			expect(store.load().验证命令).toEqual(["npm test"]);
			expect(conciseHarness(store.load())).toContain("验证命令: npm test");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("probes observable environment facts without blocking on failures", () => {
		const facts = probeHarnessFacts(process.cwd());
		expect(facts.环境?.os).toBeTruthy();
	});
});


describe("harness verify integration", () => {
	it("verify gate runs harness validation commands first", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-harness-gate-"));
		try {
			new HarnessStore(cwd).update("验证命令", "append", "node -e \"process.exit(0)\"");
			expect(await requireTestsPass(cwd)).toMatchObject({ ok: true });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("verify gate asks for harness commands when no command is observable", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-harness-gate-"));
		try {
			const result = await requireTestsPass(cwd);
			expect(result.ok).toBe(false);
			expect(result.reason).toContain("xdd_harness_set");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
