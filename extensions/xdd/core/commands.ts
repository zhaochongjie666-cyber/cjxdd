import type { XddAuditEvent } from "../audit/events.ts";
import type { HealingBaseline, HealingClosureEvidence, HealingFailure, VerifyReceipt, XddArtifactSubmission, XddDiagnose, XddEsgNodeType, XddSignal, XddStageName } from "../types.ts";

export type RunStatus = "idle" | "running" | "awaiting_approval" | "paused" | "reflecting" | "completed" | "failed";

export interface StartOptions {
	cwd: string;
	runId?: string;
	plan?: readonly XddStageName[];
	initialStage?: XddStageName;
}

export type XddCommand =
	| { type: "START"; task: string; options: StartOptions }
	| { type: "AGENT_ENDED"; stopReason: string; providerError?: string; hasPendingMessages?: boolean; contextUsagePercent?: number | null }
	| { type: "SUBMIT"; submission: XddArtifactSubmission }
	| { type: "ADVANCE" }
	| { type: "APPROVE"; approvalId: string }
	| { type: "DIAGNOSE"; diagnosis: XddDiagnose }
	| { type: "ROLLBACK"; target?: XddStageName; reason: string; failure?: Omit<HealingFailure, "signature">; ownerScopes?: string[]; closureCriteria?: string[]; baseline?: HealingBaseline }
	| { type: "RECORD_HEALING_CLOSURE"; caseId: string; closure: HealingClosureEvidence }
	| { type: "RECORD_VERIFY_RECEIPT"; receipt: VerifyReceipt }
	| { type: "STOP"; source: "command" | "escape" }
	| { type: "RESUME" }
	| { type: "RECORD_ARTIFACT_REVIEW"; stage: XddStageName; artifacts: string[]; selfAttack?: string }
	| { type: "RECORD_SIGNAL"; signal: XddSignal }
	| { type: "RECORD_ESG"; nodeType: XddEsgNodeType; stage: XddStageName; label: string; data?: unknown; parentId?: string }
	| { type: "RECORD_AUDIT_EVENT"; event: XddAuditEvent }
	| { type: "RELEASE_CONTINUATION"; reason: string }
	| { type: "COMPACTION_DONE"; success: boolean };
