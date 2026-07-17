/**
 * Whole-flow LLM budget configuration and accounting.
 *
 * `XDD_FLOW_BUDGET_USD` is intentionally read when a run starts, then persisted
 * in runtime.json. A resumed run therefore keeps the limit it was started with.
 */
export const DEFAULT_FLOW_BUDGET_USD = 500;

export interface FlowUsage {
	timestamp: number;
	tokens: number;
	costUsd: number;
}

export function configuredFlowBudgetUsd(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.XDD_FLOW_BUDGET_USD;
	if (raw === undefined || raw.trim() === "") return DEFAULT_FLOW_BUDGET_USD;
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error("XDD_FLOW_BUDGET_USD 必须是大于 0 的美元金额。");
	}
	return value;
}

/** Extract billable usage from Pi assistant messages without importing Pi types. */
export function assistantFlowUsage(messages: readonly unknown[]): FlowUsage[] {
	return messages.flatMap((message) => {
		if (!isRecord(message) || message.role !== "assistant" || !isRecord(message.usage)) return [];
		const timestamp = typeof message.timestamp === "number" ? message.timestamp : NaN;
		const tokens = asNonNegativeNumber(message.usage.totalTokens);
		const cost = isRecord(message.usage.cost) ? asNonNegativeNumber(message.usage.cost.total) : 0;
		return Number.isFinite(timestamp) ? [{ timestamp, tokens, costUsd: cost }] : [];
	});
}

function asNonNegativeNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
