import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { XddCheckpointData, XddStageName } from "./types.ts";

export type LegacyQualityRequirement = "frozen-qa-plan" | `review:${XddStageName}`;

export interface QualityMigrationManifest {
	schemaVersion: 1;
	runId: string;
	detectedStage: XddStageName;
	waivers: LegacyQualityRequirement[];
	actor: string;
	reason: string;
	runtimeIdentity: string;
	createdAt: string;
}

const STAGE_ORDER: XddStageName[] = ["init", "understand", "spec", "architecture", "wire", "resilience", "plan", "execute", "cleanup", "verify"];

function manifestPath(cwd: string): string {
	return join(cwd, ".xdd", "runs", "xdd_run", "quality-migration.json");
}

function runtime(cwd: string): XddCheckpointData {
	return JSON.parse(readFileSync(join(cwd, ".xdd", "runtime.json"), "utf8")) as XddCheckpointData;
}

function runtimeIdentity(value: XddCheckpointData): string {
	return `sha256:${createHash("sha256").update(value.runId).update("\0").update(value.userInput ?? "").digest("hex")}`;
}

export function createQualityMigration(cwd: string, actor: string, reason: string, now = new Date().toISOString()): QualityMigrationManifest {
	if (!actor.trim()) throw new Error("migration actor 不能为空");
	if (reason.trim().length < 20) throw new Error("migration reason 至少需要 20 个字符，说明为何这是升级前已开始的 run");
	const state = runtime(cwd) as XddCheckpointData & { qualityPipelineVersion?: number; qualityPipelineLegacyEligible?: boolean };
	if (!state.qualityPipelineLegacyEligible) throw new Error("当前 run 由新版质量流水线创建，不允许 legacy waiver");
	const detectedStage = state.plan?.[state.planIndex]?.stageName;
	if (!detectedStage || STAGE_ORDER.indexOf(detectedStage) <= STAGE_ORDER.indexOf("plan")) throw new Error("仅允许迁移已经越过 plan 的旧 run；更早阶段应正常生成冻结 QA 计划");
	const stageIndex = STAGE_ORDER.indexOf(detectedStage);
	const waivers: LegacyQualityRequirement[] = ["frozen-qa-plan"];
	for (const stage of STAGE_ORDER.slice(1, stageIndex)) waivers.push(`review:${stage}`);
	const manifest: QualityMigrationManifest = { schemaVersion: 1, runId: state.runId, detectedStage, waivers, actor: actor.trim(), reason: reason.trim(), runtimeIdentity: runtimeIdentity(state), createdAt: now };
	const path = manifestPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
	return manifest;
}

export function readQualityMigration(cwd: string): QualityMigrationManifest | null {
	try {
		const manifest = JSON.parse(readFileSync(manifestPath(cwd), "utf8")) as QualityMigrationManifest;
		const state = runtime(cwd) as XddCheckpointData & { qualityPipelineLegacyEligible?: boolean };
		if (manifest.schemaVersion !== 1 || !state.qualityPipelineLegacyEligible || manifest.runId !== state.runId || manifest.runtimeIdentity !== runtimeIdentity(state)) return null;
		return manifest;
	} catch { return null; }
}

export function evaluateLegacyQualityWaiver(cwd: string, requirement: LegacyQualityRequirement): boolean {
	return readQualityMigration(cwd)?.waivers.includes(requirement) ?? false;
}
