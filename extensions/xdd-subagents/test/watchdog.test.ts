import { describe, expect, it } from "vitest";
import { buildWatchdogReviewTask, type WatchdogDiff } from "../watchdog.ts";
import { loadXddSubagentsSettings } from "../settings.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("xdd subagent watchdog", () => {
	it("builds an adversarial read-only review task from diff", () => {
		const diff: WatchdogDiff = { changedFiles: ["src/a.ts"], diff: "diff --git a/src/a.ts b/src/a.ts", truncated: false };
		const task = buildWatchdogReviewTask(diff);
		expect(task).toContain("watchdog 攻击检查");
		expect(task).toContain("只读，不要修改文件");
		expect(task).toContain("src/a.ts");
		expect(task).toContain("```diff");
	});

	it("loads watchdog settings from project config", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-watchdog-settings-"));
		try {
			mkdirSync(join(cwd, ".pi"), { recursive: true });
			writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ xddSubagents: { watchdog: { enabled: true, model: "review-model", maxDiffBytes: 1234 } } }));
			const settings = loadXddSubagentsSettings(cwd);
			expect(settings.watchdog?.enabled).toBe(true);
			expect(settings.watchdog?.model).toBe("review-model");
			expect(settings.watchdog?.maxDiffBytes).toBe(1234);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
