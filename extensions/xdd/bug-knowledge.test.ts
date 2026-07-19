import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMatchingBugPatterns, generatePreventionRule, recordBugLearning, type BugLearning } from "./bug-knowledge.ts";

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "xdd-bug-kb-")); });
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

const learning: BugLearning = {
	category: "permission", component: "customer deletion API", symptom: "普通用户可以删除其他租户客户", rootCause: "controller missed tenant RBAC middleware", resolution: "attach tenant RBAC middleware before delete handler", prevention: "commit review must reject delete handlers without tenant RBAC middleware", rollbackTarget: "execute",
	source: { kind: "commit-review", id: "sha256:review-1" }, evidence: ["tests/rbac-delete.test.ts PASS"],
};

describe("bug knowledge base", () => {
	it("persists confirmed learning and retrieves a matching pattern", () => {
		const pattern = recordBugLearning(cwd, learning, "2026-01-01T00:00:00.000Z");
		expect(findMatchingBugPatterns(cwd, { category: "permission", text: "tenant middleware" })).toEqual([pattern]);
		expect(readFileSync(join(cwd, ".xdd/knowledge/bug-patterns.json"), "utf8")).toContain("tenant RBAC middleware");
	});

	it("deduplicates recurrence and upgrades its prevention rule to P1", () => {
		const performanceLearning: BugLearning = { ...learning, category: "performance", rootCause: "unbounded customer query omitted pagination limit", prevention: "code review must reject customer list queries without a pagination limit" };
		const first = recordBugLearning(cwd, performanceLearning);
		expect(generatePreventionRule(first).severity).toBe("P2");
		const repeated = recordBugLearning(cwd, { ...performanceLearning, evidence: ["runtime latency probe PASS"] });
		expect(repeated.occurrences).toBe(2);
		expect(repeated.evidence).toHaveLength(2);
		expect(generatePreventionRule(repeated)).toMatchObject({ gate: "code-review", severity: "P1" });
	});

	it("rejects vague learning without repair evidence", () => {
		expect(() => recordBugLearning(cwd, { ...learning, rootCause: "unknown", evidence: [] })).toThrow(/rootCause|证据/);
	});
});
