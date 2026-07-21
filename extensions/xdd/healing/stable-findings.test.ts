import { describe, expect, it } from "vitest";
import { blockingFindings, reconcileStableFindings } from "./stable-findings.ts";

describe("stable AIGate findings", () => {
	it("closes frozen findings and backlogs newly discovered P2 on resubmission", () => {
		const first = reconcileStableFindings("execute", [], [{ severity: "P1", category: "auth", evidence: "missing authorization" }], "2026-01-01T00:00:00Z");
		expect(blockingFindings(first)).toHaveLength(1);
		const second = reconcileStableFindings("execute", first, [{ severity: "P2", category: "wording", evidence: "rename helper" }], "2026-01-02T00:00:00Z");
		expect(second.find((item) => item.category === "auth")?.status).toBe("closed");
		expect(second.find((item) => item.category === "wording")?.status).toBe("backlog");
		expect(blockingFindings(second)).toHaveLength(0);
	});

	it("allows a new P1 to enter the blocking set", () => {
		const prior = reconcileStableFindings("execute", [], [{ severity: "P2", category: "style", evidence: "old" }]);
		const next = reconcileStableFindings("execute", prior, [{ severity: "P1", category: "security", evidence: "new injection" }]);
		expect(blockingFindings(next).map((item) => item.category)).toEqual(["security"]);
	});
});
