import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateRuntimeObservabilityGate, evaluateRuntimeObservation, recordRuntimeObservation, sanitizeRuntimeObservation, writeRuntimeBaseline, type RuntimeObservation } from "./runtime-observability.ts";

let cwd: string;
let head: string;
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "xdd-runtime-"));
	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
	execFileSync("git", ["config", "user.name", "Test"], { cwd });
	writeFileSync(join(cwd, "README.md"), "runtime\n");
	execFileSync("git", ["add", "README.md"], { cwd });
	execFileSync("git", ["commit", "-qm", "init"], { cwd });
	head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function observation(value = 100): RuntimeObservation {
	return { schemaVersion: 1, deploymentId: "deploy-1", commitSha: head, capturedAt: new Date().toISOString(), metrics: [{ name: "latency_ms", value, unit: "ms", direction: "lower", maxRegressionPct: 20, critical: true }], logs: ["authorization: Bearer secret-token user=a@example.com ip=10.0.0.1"], traces: [] };
}

describe("runtime observability adapter", () => {
	it("soft-skips projects that have no deployable runtime baseline", () => {
		expect(evaluateRuntimeObservabilityGate(cwd)).toMatchObject({ ok: true, soft: true });
	});

	it("redacts credentials, email, and IP before persistence", () => {
		const sanitized = sanitizeRuntimeObservation(observation());
		expect(sanitized.logs[0]).not.toContain("secret-token");
		expect(sanitized.logs[0]).not.toContain("a@example.com");
		expect(sanitized.logs[0]).not.toContain("10.0.0.1");
	});

	it("creates a blocking incident for a critical regression", () => {
		const incident = evaluateRuntimeObservation(observation(100), observation(150));
		expect(incident.status).toBe("open");
		expect(incident.findings[0]).toMatchObject({ severity: "P1", metric: "latency_ms" });
		expect(incident.difference.tasks[0]).toContain("重新部署");
	});

	it("persists a clear observation bound to HEAD and passes the runtime gate", () => {
		writeRuntimeBaseline(cwd, observation(100));
		recordRuntimeObservation(cwd, observation(110));
		expect(evaluateRuntimeObservabilityGate(cwd)).toEqual({ ok: true, soft: false });
		const persisted = readFileSync(join(cwd, ".xdd/runs/xdd_run/runtime-observability/latest.json"), "utf8");
		expect(persisted).not.toContain("secret-token");
	});

	it("rejects an observation for a stale commit", () => {
		writeRuntimeBaseline(cwd, observation(100));
		recordRuntimeObservation(cwd, { ...observation(110), commitSha: "stale" });
		expect(evaluateRuntimeObservabilityGate(cwd)).toMatchObject({ ok: false });
	});
});
