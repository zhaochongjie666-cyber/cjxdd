import { describe, expect, it } from "vitest";
import { buildXddCompaction } from "./xdd-compaction.ts";

describe("buildXddCompaction", () => {
	it("returns a complete local compaction without a provider call", () => {
		const result = buildXddCompaction({
			firstKeptEntryId: "keep-1",
			messagesToSummarize: [],
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 371_000,
			fileOps: { read: new Set(["README.md"]), written: new Set(["src/app.ts"]), edited: new Set() },
			settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
		}, "Run: r1\nStage: resilience");

		expect(result).toMatchObject({
			firstKeptEntryId: "keep-1",
			tokensBefore: 371_000,
			details: { xddProviderFree: true },
		});
		expect(result.summary).toContain("Stage: resilience");
	});

	it("bounds an inherited summary so repeated compactions cannot grow forever", () => {
		const result = buildXddCompaction({
			firstKeptEntryId: "keep-2",
			messagesToSummarize: [],
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 400_000,
			previousSummary: `old-prefix-${"x".repeat(20_000)}`,
			fileOps: { read: new Set(), written: new Set(), edited: new Set() },
			settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
		}, "current-state");

		expect(result.summary.length).toBeLessThan(13_000);
		expect(result.summary).not.toContain("old-prefix");
		expect(result.summary).toContain("current-state");
	});
});
