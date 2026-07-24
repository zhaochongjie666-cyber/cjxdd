import type { NfCommand } from "../core/commands.ts";
import type { NfEffect } from "../core/effects.ts";
import type { NfEsgNodeType, NfStageName } from "../types.ts";

export type NfAuditEvent =
	| { type: "command_accepted"; command: NfCommand["type"]; stage: NfStageName | "?" }
	| { type: "command_rejected"; command: NfCommand["type"]; stage: NfStageName | "?"; code: string; message: string }
	| { type: "effect_success"; effect: NfEffect["type"]; stage: NfStageName | "?"; detail?: string }
	| { type: "effect_fail"; effect: NfEffect["type"]; stage: NfStageName | "?"; message: string }
	| { type: "gate_result"; stage: NfStageName; stageIndex: number; passed: boolean; artifacts?: string[]; reason?: string }
	| { type: "hook_result"; stage: NfStageName | "?"; hook: string; action: "pass" | "block" | "continue"; warnings?: string[]; data?: unknown }
	| { type: "provider_error"; stage: NfStageName | "?"; message: string }
	| { type: "task_result"; stage: NfStageName; action: string; met: number; unmet: number }
	| { type: "esg_record"; nodeType: NfEsgNodeType; stage: NfStageName; label: string; data?: unknown; parentId?: string };
