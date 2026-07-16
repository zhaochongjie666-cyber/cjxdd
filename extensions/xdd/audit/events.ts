import type { XddCommand } from "../core/commands.ts";
import type { XddEffect } from "../core/effects.ts";
import type { XddEsgNodeType, XddStageName } from "../types.ts";

export type XddAuditEvent =
	| { type: "command_accepted"; command: XddCommand["type"]; stage: XddStageName | "?" }
	| { type: "command_rejected"; command: XddCommand["type"]; stage: XddStageName | "?"; code: string; message: string }
	| { type: "effect_success"; effect: XddEffect["type"]; stage: XddStageName | "?"; detail?: string }
	| { type: "effect_fail"; effect: XddEffect["type"]; stage: XddStageName | "?"; message: string }
	| { type: "gate_result"; stage: XddStageName; stageIndex: number; passed: boolean; artifacts?: string[]; reason?: string }
	| { type: "hook_result"; stage: XddStageName | "?"; hook: string; action: "pass" | "block" | "continue"; warnings?: string[]; data?: unknown }
	| { type: "provider_error"; stage: XddStageName | "?"; message: string }
	| { type: "task_result"; stage: XddStageName; action: string; met: number; unmet: number }
	| { type: "esg_record"; nodeType: XddEsgNodeType; stage: XddStageName; label: string; data?: unknown; parentId?: string };
