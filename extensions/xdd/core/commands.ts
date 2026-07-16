import type { XddArtifactSubmission, XddDiagnose, XddStageName } from "../types.ts";

export type RunStatus = "idle" | "running" | "awaiting_approval" | "paused" | "reflecting" | "completed" | "failed";

export interface StartOptions {
	cwd: string;
	runId?: string;
	plan?: readonly XddStageName[];
}

export type XddCommand =
	| { type: "START"; task: string; options: StartOptions }
	| { type: "AGENT_ENDED"; stopReason: string; providerError?: string; hasPendingMessages?: boolean }
	| { type: "SUBMIT"; submission: XddArtifactSubmission }
	| { type: "ADVANCE" }
	| { type: "APPROVE"; approvalId: string }
	| { type: "DIAGNOSE"; diagnosis: XddDiagnose }
	| { type: "ROLLBACK"; target?: XddStageName; reason: string }
	| { type: "STOP"; source: "command" | "escape" }
	| { type: "RESUME" }
	| { type: "COMPACTION_DONE"; success: boolean };
