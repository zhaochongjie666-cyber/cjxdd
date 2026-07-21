export type HealingMode = "observe" | "enforce";

export function healingMode(env: NodeJS.ProcessEnv = process.env): HealingMode {
	return env.XDD_HEALING_CASES === "observe" ? "observe" : "enforce";
}

export function healingEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
	return healingMode(env) === "enforce";
}
