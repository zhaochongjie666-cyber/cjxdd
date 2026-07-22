const MAX_PREVIOUS_SUMMARY_CHARS = 12_000;

interface XddCompactionPreparation {
	firstKeptEntryId: string;
	tokensBefore: number;
	previousSummary?: string;
	fileOps: {
		read: Set<string>;
		written: Set<string>;
		edited: Set<string>;
	};
}

/**
 * Build a provider-free compaction result for an active xdd run.
 *
 * Pi's normal compactor asks the current model to summarize the discarded
 * messages.  Once a provider already rejects the oversized context, that
 * second request can be rejected for the same reason.  xdd can recover without
 * that request because its workflow state and deliverables are persisted.
 */
export function buildXddCompaction(
	preparation: XddCompactionPreparation,
	workflowSummary: string,
) {
	const previous = preparation.previousSummary?.slice(-MAX_PREVIOUS_SUMMARY_CHARS).trim();
	const summary = [
		"# xdd context handoff",
		"The conversation was compacted locally; continue from persisted xdd state and files.",
		previous ? `\n## Previous handoff (bounded)\n${previous}` : "",
		`\n## Current workflow state\n${workflowSummary}`,
	].filter(Boolean).join("\n");

	return {
		summary,
		firstKeptEntryId: preparation.firstKeptEntryId,
		tokensBefore: preparation.tokensBefore,
		details: {
			readFiles: [...preparation.fileOps.read]
				.filter((path) => !preparation.fileOps.written.has(path) && !preparation.fileOps.edited.has(path))
				.sort(),
			modifiedFiles: [...preparation.fileOps.written, ...preparation.fileOps.edited].sort(),
			xddProviderFree: true,
		},
	};
}
