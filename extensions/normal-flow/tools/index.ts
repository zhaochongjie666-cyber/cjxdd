import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { NfRunnerState } from "../types.ts";

export type EmptyDetails = Record<string, never>;

export function ok(text: string): AgentToolResult<EmptyDetails> {
	return { content: [{ type: "text", text }], details: {} };
}

export type GetNfState = () => NfRunnerState;

import { createNfObserveTool } from "./nf-observe.ts";
import { createNfDesiredStateTool } from "./nf-desired-state.ts";
import { createNfDifferenceTool } from "./nf-difference.ts";
import { createNfSubmitArtifactTool } from "./nf-submit-artifact.ts";
import { createNfAdvanceTool } from "./nf-advance.ts";
import { createNfRollbackTool } from "./nf-rollback.ts";

export function createNfTools(getState: GetNfState): ToolDefinition[] {
	return [
		createNfSubmitArtifactTool(getState),
		createNfAdvanceTool(getState),
		createNfObserveTool(getState),
		createNfDesiredStateTool(getState),
		createNfDifferenceTool(getState),
		createNfRollbackTool(getState),
	];
}
