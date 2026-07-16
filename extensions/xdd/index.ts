export { isDiagnoseLayer, isStageName } from "./diagnosis.ts";
import { xddInlineExtension } from "./extension.ts";
export { activateXddExtension, deactivateXddExtension, xddInlineExtension } from "./extension.ts";
// pi ExtensionAPI expects a default-exported factory function.
export default xddInlineExtension.factory;
export { runXdd, continueXdd, resumeXdd, xddStatus, archiveXdd } from "./run.ts";
export { archiveRun } from "./archive.ts";
export { loadXddSkills } from "./skill-loader.ts";
export {
	gitHasChanges,
	requireGlobs,
	requireGlobsWithKeywords,
	requireGlobsWithMinSize,
	softPass,
} from "./gate.ts";
export { STAGES } from "./stages.ts";
export { compileStageContracts, StageContractError, scopeCoversPattern } from "./core/stage-contract.ts";
export { XddController, transition, schedulerText, ControllerError } from "./core/controller.ts";
export { HeadlessXddController } from "./adapters/headless-controller.ts";
export { pruneContextMessages, buildXddCompactionInstructions, BASH_OUTPUT_STUB } from "./context-prune.ts";
export { projectAuditEvent } from "./audit/projector.ts";
export type { XddAuditEvent } from "./audit/events.ts";
export { STAGE_GROUPS, findStageGroup, isLastStageInGroup } from "./stage-groups.ts";
export { writeCheckpoint, readCheckpoint, removeCheckpoint } from "./checkpoint.ts";
export { RuntimeStore, atomicWriteJson } from "./storage/runtime-store.ts";
export { migrateRuntimeState, RUNTIME_SCHEMA_VERSION } from "./storage/runtime-migrations.ts";
export type { RuntimeStateV2, RuntimeMigrationResult } from "./storage/runtime-migrations.ts";
export type { XddCommand, RunStatus, StartOptions } from "./core/commands.ts";
export type { XddEffect } from "./core/effects.ts";
export { HookRunner, discoverHookFiles } from "./hooks/runner.ts";
export { scaffoldHooks } from "./hooks/scaffold.ts";
export type { HookPayload, HookPoint, HookOutput, HookRunResult } from "./hooks/protocol.ts";
export type {
	ActiveXddRun,
	XddApprovalDecision,
	XddApprovalEvent,
	AiGateContract,
	ArtifactRule,
	XddArtifactSubmission,
	XddCheckpointData,
	XddDiagnose,
	XddDiagnoseLayer,
	XddEsgNode,
	XddEsgNodeType,
	XddEvent,
	RollbackPolicy,
	SkipPredicate,
	XddGatePolicy,
	XddGateResult,
	XddLedgerEntry,
	XddRunnerMode,
	XddRunOptions,
	XddRunResult,
	XddRuntime,
	XddRuntimeMessage,
	XddSignal,
	XddStageExit,
	XddStageGroup,
	XddStageGroupName,
	XddStageName,
	XddStageSpec,
	XddStatus,
	XddTaskInstruction,
} from "./types.ts";
export { DIAGNOSE_LAYERS, XddRunnerState } from "./types.ts";
