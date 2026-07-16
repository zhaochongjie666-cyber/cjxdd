export type XddEffect =
	| { type: "SEND_FOLLOWUP"; text: string; epoch: number }
	| { type: "NOTIFY"; level: "info" | "warning" | "error"; text: string }
	| { type: "ABORT_AGENT" }
	| { type: "COMPACT"; instructions: string }
	| { type: "SET_ACTIVE_TOOLS"; tools: string[] }
	| { type: "RUN_HOOK"; point: string; payload: unknown }
	| { type: "APPEND_SESSION_ENTRY"; customType: string; data: unknown };
