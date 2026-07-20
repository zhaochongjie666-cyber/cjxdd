import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { XddRunnerState } from "../../xdd/types.ts";

export type EmptyDetails = Record<string, never>;

export function ok(text: string): AgentToolResult<EmptyDetails> {
	return { content: [{ type: "text", text }], details: {} };
}

export type GetNfState = () => XddRunnerState;

import { createNfObserveTool } from "./nf-observe.ts";
import { createNfDesiredStateTool } from "./nf-desired-state.ts";
import { createNfDifferenceTool } from "./nf-difference.ts";
import { createNfSubmitArtifactTool } from "./nf-submit-artifact.ts";
import { createNfAdvanceTool } from "./nf-advance.ts";
import { createNfRollbackTool } from "./nf-rollback.ts";
import { createNfWanderTool } from "./nf-wander.ts";

export function createNfTools(getState: GetNfState): ToolDefinition[] {
	return [
		createNfSubmitArtifactTool(getState),
		createNfAdvanceTool(getState),
		createNfObserveTool(getState),
		createNfDesiredStateTool(getState),
		createNfDifferenceTool(getState),
		createNfRollbackTool(getState),
		createNfWanderTool(getState),
	];
}
