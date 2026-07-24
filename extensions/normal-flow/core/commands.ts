/**
 * Normal Flow 专用命令类型。从 xdd 的 XddCommand 精简而来：
 * 去掉了 HEALING_CLOSURE / VERIFY_RECEIPT / APPROVE / DIAGNOSE--
 * NF 没有 healing closure 工具、没有 AIGate、没有 human approval、没有反思机制。
 *
 * ROLLBACK 也被简化：不需要 failure/ownerScopes/closureCriteria/baseline
 * （那些是给 HealingCase 用的，NF 不创建 HealingCase）。
 */
import type { NfArtifactSubmission, NfEsgNodeType, NfSignal, NfStageName } from "../types.ts";

export interface NfStartOptions {
	cwd: string;
	runId?: string;
}

export type NfCommand =
	| { type: "START"; task: string; options: NfStartOptions }
	| { type: "AGENT_ENDED"; stopReason: string; providerError?: string; hasPendingMessages?: boolean }
	| { type: "SUBMIT"; submission: NfArtifactSubmission }
	| { type: "ADVANCE" }
	| { type: "ROLLBACK"; target: NfStageName; reason: string }
	| { type: "STOP"; source: "command" | "escape" }
	| { type: "RESUME" }
	| { type: "RECORD_ARTIFACT_REVIEW"; stage: NfStageName; artifacts: string[] }
	| { type: "RECORD_SIGNAL"; signal: NfSignal }
	| { type: "RECORD_ESG"; nodeType: NfEsgNodeType; stage: NfStageName; label: string; data?: unknown; parentId?: string }
	| { type: "RELEASE_CONTINUATION"; reason: string };
