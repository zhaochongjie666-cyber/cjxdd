import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordBugLearning, type BugLearning } from "./bug-knowledge.ts";
import { buildPreventionContext } from "./prevention-context.ts";
import { buildStageSystemPrompt } from "./context.ts";
import { STAGES } from "./stages.ts";

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "xdd-prevention-")); });
afterEach(() => rmSync(cwd, { recursive: true, force: true }));
const learning = (category: BugLearning["category"], component: string, prevention: string): BugLearning => ({ category, component, symptom: `${component} produced a confirmed production failure`, rootCause: `${component} omitted a required defensive boundary`, resolution: `repair ${component} and verify the negative path`, prevention, rollbackTarget: "execute", source: { kind: "manual", id: component }, evidence: ["regression test PASS"] });

describe("prevention context injection", () => {
	it("injects bounded relevant historical rules and records pattern IDs", () => {
		recordBugLearning(cwd, learning("permission", "tenant delete endpoint", "require tenant RBAC on every destructive endpoint"));
		recordBugLearning(cwd, learning("performance", "search endpoint", "require bounded pagination for search queries"));
		const result = buildPreventionContext(cwd, "execute", "change tenant delete endpoint", 1);
		expect(result.text).toContain("tenant RBAC");
		expect(result.text).not.toContain("pagination");
		expect(readFileSync(join(cwd, ".xdd/runs/xdd_run/prevention-injections.json"), "utf8")).toContain(result.patternIds[0]);
	});

	it("does not inject a category into an unrelated stage", () => {
		recordBugLearning(cwd, learning("performance", "batch query", "require a measured latency budget"));
		expect(buildPreventionContext(cwd, "spec", "user contract")).toEqual({ text: "", patternIds: [] });
	});

	it("deduplicates repeated prompt construction for the same rule set", () => {
		recordBugLearning(cwd, learning("resilience", "payment dependency", "require timeout fallback and recovery evidence"));
		buildPreventionContext(cwd, "resilience", "payment dependency");
		buildPreventionContext(cwd, "resilience", "payment dependency");
		const audit = JSON.parse(readFileSync(join(cwd, ".xdd/runs/xdd_run/prevention-injections.json"), "utf8"));
		expect(audit).toHaveLength(1);
	});

	it("automatically places matched rules in the coding agent stage prompt", () => {
		recordBugLearning(cwd, learning("permission", "tenant delete endpoint", "require tenant RBAC before destructive actions"));
		const stage = STAGES.find((item) => item.name === "execute")!;
		const prompt = buildStageSystemPrompt({ cwd, stage, userInput: "change tenant delete endpoint", skills: [], planIndex: 7, planTotal: 10 });
		expect(prompt).toContain("历史缺陷预防规则");
		expect(prompt).toContain("tenant RBAC");
	});
});
