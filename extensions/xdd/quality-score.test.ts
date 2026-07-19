import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildQualityScore, evaluateQualityScoreGate, writeQualityScore } from "./quality-score.ts";
import { recordBugLearning, type BugLearning } from "./bug-knowledge.ts";

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "xdd-quality-")); });
afterEach(() => rmSync(cwd, { recursive: true, force: true }));
function put(path: string, value: unknown): void { const full = join(cwd, path); mkdirSync(join(full, ".."), { recursive: true }); writeFileSync(full, typeof value === "string" ? value : JSON.stringify(value)); }

const learning: BugLearning = { category: "performance", component: "customer query endpoint", symptom: "customer listing exceeds latency objective", rootCause: "database query omitted required pagination limit", resolution: "add bounded cursor pagination to customer query", prevention: "review customer queries for a bounded pagination limit", rollbackTarget: "execute", source: { kind: "qa", id: "QA-1" }, evidence: ["pagination acceptance test PASS"] };

describe("quality score", () => {
	it("scores observable evidence and remains a soft diagnostic", () => {
		for (const file of ["qa-plan.md", "verify-report.md", "code-review.json", "commit-review.json"]) put(`.xdd/runs/xdd_run/${file}`, file.endsWith(".json") ? {} : "evidence");
		put(".xdd/runs/xdd_run/runtime-observability/incident.json", { findings: [], createdAt: "2026-01-01T00:00:00Z", deploymentId: "d1" });
		const score = buildQualityScore(cwd);
		expect(score).toMatchObject({ score: 100, status: "healthy" });
		writeQualityScore(cwd, score);
		expect(evaluateQualityScoreGate(cwd)).toMatchObject({ ok: true, soft: false });
	});

	it("penalizes recurrence, escaped defects and overrides without becoming an infinite hard gate", () => {
		recordBugLearning(cwd, learning); recordBugLearning(cwd, learning);
		put(".xdd/runs/xdd_run/reviews/execute.json", { override: { actor: "owner" } });
		put(".xdd/runs/xdd_run/runtime-observability/incident.json", { findings: [{ severity: "P1" }, { severity: "P2" }] });
		const score = buildQualityScore(cwd);
		expect(score.score).toBeLessThan(80);
		expect(score.metrics.find((metric) => metric.name === "recurrence-rate")?.penalty).toBeGreaterThan(0);
		writeQualityScore(cwd, score);
		expect(evaluateQualityScoreGate(cwd)).toMatchObject({ ok: true, soft: true });
	});

	it("invalidates a stale score when upstream evidence changes", () => {
		writeQualityScore(cwd, buildQualityScore(cwd));
		put(".xdd/runs/xdd_run/verify-report.md", "new evidence");
		expect(evaluateQualityScoreGate(cwd)).toMatchObject({ ok: false });
	});
});
