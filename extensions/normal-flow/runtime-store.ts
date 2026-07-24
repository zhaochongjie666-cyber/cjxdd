/** Re-export 自 storage/，保持旧 import 路径兼容。 */
export { RuntimeStore, type RuntimeStoreOptions, type RuntimeStoreSaveOptions, atomicWriteJson } from "./storage/runtime-store.ts";
export { NORMAL_FLOW_RUNTIME_FILE, NORMAL_FLOW_V1_BACKUP_FILE } from "./runtime-store-constants.ts";
import { RuntimeStore } from "./storage/runtime-store.ts";
import { NORMAL_FLOW_RUNTIME_FILE, NORMAL_FLOW_V1_BACKUP_FILE } from "./runtime-store-constants.ts";
export function createNormalFlowRuntimeStore(cwd: string): RuntimeStore {
	return new RuntimeStore(cwd, { runtimeFileName: NORMAL_FLOW_RUNTIME_FILE, legacyCheckpointFileName: false, v1BackupFileName: NORMAL_FLOW_V1_BACKUP_FILE });
}
