import { reconcileSubagentRuns, type ReconcileReport } from "./reconciler.ts";
import { loadXddSubagentsSettings } from "./settings.ts";

export type AutoDrainResult = { enabled: boolean; notify: boolean; report?: ReconcileReport };

export function runAutoDrainIfEnabled(cwd: string): AutoDrainResult {
	const autoDrain = loadXddSubagentsSettings(cwd).autoDrain;
	if (!autoDrain?.enabled) return { enabled: false, notify: false };
	const report = reconcileSubagentRuns(cwd);
	return { enabled: true, notify: autoDrain.notify ?? true, report };
}
