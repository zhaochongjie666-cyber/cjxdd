import { describe, expect, it } from "vitest";
import { renderStaticDiagnostics } from "../diagnostics.ts";
import { recommendWatchdogModel } from "../watchdog-model.ts";
import { buildWatchdogReviewTask, type WatchdogDiff } from "../watchdog.ts";

describe("xdd watchdog model and diagnostics", () => {
	it("recommends a complementary strong watchdog model", () => {
		expect(recommendWatchdogModel("openai-codex/gpt-5.5")).toBe("anthropic/claude-opus-4-8:high");
		expect(recommendWatchdogModel("anthropic/claude-opus-4-8")).toBe("openai-codex/gpt-5.5:high");
	});

	it("renders diagnostics into watchdog tasks", () => {
		const diff: WatchdogDiff = { changedFiles: ["src/a.ts"], diff: "diff --git a/src/a.ts b/src/a.ts", truncated: false };
		const diagnostics = renderStaticDiagnostics({ status: "failed", command: "npx tsc --noEmit --pretty false", output: "src/a.ts(1,1): error TS1005" });
		const task = buildWatchdogReviewTask(diff, diagnostics);
		expect(task).toContain("## Static Diagnostics");
		expect(task).toContain("error TS1005");
	});
});
