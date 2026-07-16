/**
 * Phase 3 (C) P28: replace numeric message-index boundary with string-based
 * stageEpoch slicing. The epoch is "runId:stage:attempt"; the context hook
 * keeps only messages from the latest epoch forward, plus the most recent
 * compaction summary.
 *
 * Extracted from extension.ts so the unit test can import it without
 * pulling in the pi-tui transitive dep.
 */

import type { AgentMessage } from "@earendil-works/pi-coding-agent";

/** Marker that the agent's last user/assistant message contains the current
 *  stageEpoch. We look for this prefix in user messages injected by
 *  before_agent_start. The marker is in the message TEXT so it survives
 *  compaction (compaction summary includes the text it summarizes). */
export const EPOCH_MARKER_PREFIX = "## xdd-stage-epoch:";

/** Find the first message index whose text contains the epoch marker. */
function findEpochMarkerIndex(messages: readonly AgentMessage[], epoch: string): number {
	const want = `${EPOCH_MARKER_PREFIX} ${epoch}`;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "user") continue;
		const content = m.content;
		const text = typeof content === "string"
			? content
			: Array.isArray(content)
				? content.filter((c: { type?: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("\n")
				: "";
		if (text.includes(want)) return i;
	}
	return -1;
}

/** Find the most recent compaction summary. */
function findLastCompactionIndex(messages: readonly AgentMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "compactionSummary") return i;
	}
	return -1;
}

/**
 * Slice messages to keep only the current epoch forward, plus the most
 * recent compaction summary if it's later than the epoch marker. Returns
 * the original array (or a no-op slice) when no slicing is needed.
 *
 * Invariants:
 *   - if no epoch marker found, return messages as-is (we're at the
 *     beginning of the stage; nothing older is xdd-specific).
 *   - if a compaction summary exists AFTER the epoch marker, use the
 *     compaction summary as the slice start instead (the summary
 *     already encapsulates the stage's prior progress).
 *   - if the epoch marker is the most recent marker, slice from there.
 */
export function sliceByEpoch(
	messages: readonly AgentMessage[],
	epoch: string,
): AgentMessage[] {
	if (!epoch || epoch.endsWith("?:0")) return messages as AgentMessage[];

	const epochIdx = findEpochMarkerIndex(messages, epoch);
	if (epochIdx < 0) {
		// No marker yet -- this is the first turn of the stage. Pass through.
		return messages as AgentMessage[];
	}
	const compactionIdx = findLastCompactionIndex(messages);
	const startIdx = compactionIdx > epochIdx ? compactionIdx : epochIdx;
	if (startIdx <= 0) return messages as AgentMessage[];
	return messages.slice(startIdx) as AgentMessage[];
}
