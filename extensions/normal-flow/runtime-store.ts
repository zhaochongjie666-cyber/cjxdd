import { RuntimeStore } from "../xdd/storage/runtime-store.ts";

export const NORMAL_FLOW_RUNTIME_FILE = "normal-flow-runtime.json";
export const NORMAL_FLOW_V1_BACKUP_FILE = "normal-flow-runtime.v1.backup.json";

/**
 * Normal Flow has its own checkpoint file so switching between /xdd and
 * /normal-flow never overwrites or resumes the other flow's runtime state.
 */
export function createNormalFlowRuntimeStore(cwd: string): RuntimeStore {
	return new RuntimeStore(cwd, {
		runtimeFileName: NORMAL_FLOW_RUNTIME_FILE,
		legacyCheckpointFileName: false,
		v1BackupFileName: NORMAL_FLOW_V1_BACKUP_FILE,
	});
}
