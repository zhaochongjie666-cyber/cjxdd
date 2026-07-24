export type NfEffect =
	| { type: "SEND_FOLLOWUP"; text: string; epoch: number; delayMs?: number }
	| { type: "NOTIFY"; level: "info" | "warning" | "error"; text: string }
	| { type: "ABORT_AGENT" }
	| { type: "SET_ACTIVE_TOOLS"; tools: string[] }
	| { type: "RUN_HOOK"; point: string; payload: unknown }
	| { type: "APPEND_SESSION_ENTRY"; customType: string; data: unknown };
