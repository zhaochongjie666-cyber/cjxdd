import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeStore } from "./runtime-store.ts";
import { migrateRuntimeState } from "./runtime-migrations.ts";
import type { XddCheckpointData } from "../types.ts";
import { MAX_RUNTIME_ESG_NODES } from "../audit/projector.ts";

let cwd = "";

const baseRuntime = (): XddCheckpointData => ({
	runId: "r1",
	userInput: "test",
	cwd,
	planIndex: 0,
	plan: [],
	mode: "stage",
	ledger: [],
	attempts: {},
	selfHealUsed: {},
	maxRollbacksPerStage: 2,
	maxSelfHealPerStage: 5,
	flowRollbackCount: 0,
	lifetimeRollbackCount: 0,
	healingSequence: 0,
	healingCases: [],
	verifyGeneration: 0,
	budgetResetHistory: [],
	aiGateFindings: {},
	flowRollbackLimit: 7,
	rollbackCount: 0,
	status: "running",
	submittedArtifacts: {},
	selfAttackNotes: {},
	esg: [],
	at: "2026-07-16T00:00:00.000Z",
});

beforeEach(() => {
	cwd = join(tmpdir(), `xdd-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	mkdirSync(join(cwd, ".xdd"), { recursive: true });
});

afterEach(() => {
	if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
});

describe("RuntimeStore", () => {
	it("keeps the old runtime readable if a write crashes before rename", () => {
		const store = new RuntimeStore(cwd);
		store.save({ ...baseRuntime(), runId: "old" });
		expect(() => store.save({ ...baseRuntime(), runId: "new" }, { simulateCrashBeforeRename: true })).toThrow(/simulated crash/);
		expect(store.load()?.runId).toBe("old");
	});

	it("migrates v1/no-schema runtime to schemaVersion 4 and writes a backup", () => {
		const store = new RuntimeStore(cwd);
		writeFileSync(store.runtimePath, JSON.stringify({ ...baseRuntime(), runId: "legacy" }, null, 2), "utf8");
		const loaded = store.load();
		expect(loaded?.schemaVersion).toBe(4);
		expect(loaded?.healingCases).toEqual([]);
		expect(loaded?.lifetimeRollbackCount).toBe(0);
		expect(loaded?.runId).toBe("legacy");
		expect(loaded?.qualityPipelineLegacyEligible).toBe(true);
		expect(existsSync(store.v1BackupPath)).toBe(true);
	});

	it("rejects unknown future schema versions", () => {
		expect(() => migrateRuntimeState({ ...baseRuntime(), schemaVersion: 999 })).toThrow(/高于当前支持版本/);
	});

	it("updates through a single RuntimeStore facade", () => {
		const store = new RuntimeStore(cwd);
		const updated = store.update((state) => ({ ...state, ...baseRuntime(), runId: "updated", planIndex: 3 }));
		expect(updated.schemaVersion).toBe(4);
		expect(JSON.parse(readFileSync(store.runtimePath, "utf8")).planIndex).toBe(3);
	});

	it("persists in-place mutations made by update callbacks", () => {
		const store = new RuntimeStore(cwd);
		store.save(baseRuntime());
		store.update((state) => { state.activeHealingCaseId = "HC-001"; });
		expect(store.load()?.activeHealingCaseId).toBe("HC-001");
	});

	it("compacts legacy unbounded ESG history whenever runtime is saved", () => {
		const store = new RuntimeStore(cwd);
		const esg = Array.from({ length: MAX_RUNTIME_ESG_NODES + 25 }, (_, index) => ({
			id: `esg-${index + 1}`,
			type: "evidence" as const,
			stage: "init" as const,
			label: `event ${index + 1}`,
			at: "2026-07-16T00:00:00.000Z",
		}));

		store.save({ ...baseRuntime(), esg });

		const persisted = store.load()!.esg;
		expect(persisted).toHaveLength(MAX_RUNTIME_ESG_NODES);
		expect(persisted[0].id).toBe("esg-26");
		expect(persisted.at(-1)?.id).toBe(`esg-${MAX_RUNTIME_ESG_NODES + 25}`);
	});

	it("migrates tiered flow rollback fields to one persisted limit", () => {
		const migrated = migrateRuntimeState({ ...baseRuntime(), schemaVersion: 2, flowRollbackLimitTier1: 5, flowRollbackLimitTier2: 10 });
		expect(migrated.state.flowRollbackLimit).toBe(7);
		expect(migrated.state).not.toHaveProperty("flowRollbackLimitTier1");
		expect(migrated.state).not.toHaveProperty("flowRollbackLimitTier2");
	});

	it("migrates v3 without fabricating a healing case and preserves rollback history", () => {
		const migrated = migrateRuntimeState({ ...baseRuntime(), schemaVersion: 3, flowRollbackCount: 6, healingCases: undefined, lifetimeRollbackCount: undefined });
		expect(migrated.migratedFrom).toBe(3);
		expect(migrated.state.healingCases).toEqual([]);
		expect(migrated.state.activeHealingCaseId).toBeUndefined();
		expect(migrated.state.lifetimeRollbackCount).toBe(6);
	});
});
