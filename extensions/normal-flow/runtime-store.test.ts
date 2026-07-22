import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeStore } from "../xdd/storage/runtime-store.ts";
import { XddRunnerState, type XddCheckpointData } from "../xdd/types.ts";
import { createNormalFlowRuntimeStore, NORMAL_FLOW_RUNTIME_FILE, NORMAL_FLOW_V1_BACKUP_FILE } from "./runtime-store.ts";
import { NF_STAGES } from "./stages.ts";

let cwd = "";

const baseRuntime = (runId: string): XddCheckpointData => ({
	runId,
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
	flowRollbackLimit: 7,
	rollbackCount: 0,
	status: "running",
	submittedArtifacts: {},
	selfAttackNotes: {},
	esg: [],
	at: "2026-07-16T00:00:00.000Z",
});

beforeEach(() => {
	cwd = join(tmpdir(), `nf-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	mkdirSync(join(cwd, ".xdd"), { recursive: true });
});

afterEach(() => {
	if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
});

describe("Normal Flow RuntimeStore", () => {
	it("persists to a separate JSON file from xdd runtime.json", () => {
		const xddStore = new RuntimeStore(cwd);
		const nfStore = createNormalFlowRuntimeStore(cwd);

		xddStore.save(baseRuntime("xdd-run"));
		nfStore.save(baseRuntime("nf-run"));

		expect(xddStore.runtimePath).toBe(join(cwd, ".xdd", "runtime.json"));
		expect(nfStore.runtimePath).toBe(join(cwd, ".xdd", NORMAL_FLOW_RUNTIME_FILE));
		expect(xddStore.load()?.runId).toBe("xdd-run");
		expect(nfStore.load()?.runId).toBe("nf-run");
		expect(JSON.parse(readFileSync(join(cwd, ".xdd", "runtime.json"), "utf8")).runId).toBe("xdd-run");
		expect(JSON.parse(readFileSync(join(cwd, ".xdd", NORMAL_FLOW_RUNTIME_FILE), "utf8")).runId).toBe("nf-run");
	});

	it("does not fall back to xdd checkpoint.json", () => {
		const xddStore = new RuntimeStore(cwd);
		xddStore.save(baseRuntime("xdd-only"));

		expect(createNormalFlowRuntimeStore(cwd).load()).toBeUndefined();
	});

	it("lets Normal Flow runner state read the same runtime file as the controller", () => {
		const nfStore = createNormalFlowRuntimeStore(cwd);
		nfStore.save({
			...baseRuntime("nf-run"),
			plan: NF_STAGES.map((stage, originalIndex) => ({ stageName: stage.name, originalIndex })),
			signals: ["complete"],
		});
		new RuntimeStore(cwd).save({
			...baseRuntime("xdd-run"),
			signals: [],
		});

		const state = new XddRunnerState({
			runId: "nf-run",
			cwd,
			userInput: "test",
			runtimeStoreOptions: {
				runtimeFileName: NORMAL_FLOW_RUNTIME_FILE,
				legacyCheckpointFileName: false,
				v1BackupFileName: NORMAL_FLOW_V1_BACKUP_FILE,
			},
		});
		state.plan = NF_STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));

		expect(state.currentStage()?.name).toBe("understand");
		expect(state.getSignals().has("complete")).toBe(true);
	});
});
