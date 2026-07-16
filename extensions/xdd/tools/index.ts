import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { XddRunnerState } from "../types.ts";

export type EmptyDetails = Record<string, never>;

export function ok(text: string): AgentToolResult<EmptyDetails> {
	return { content: [{ type: "text", text }], details: {} };
}

export type GetXddState = () => XddRunnerState;

import { createXddAdvanceTool } from "./xdd-advance.ts";
import { createXddDesiredStateTool } from "./xdd-desired-state.ts";
import { createXddDiagnoseTool } from "./xdd-diagnose.ts";
import { createXddDifferenceTool } from "./xdd-difference.ts";
import { createXddListSkillsTool } from "./xdd-list-skills.ts";
import { createXddLoadSkillTool } from "./xdd-load-skill.ts";
import { createXddNextTaskTool } from "./xdd-next-task.ts";
import { createXddObserveTool } from "./xdd-observe.ts";
import { createXddRollbackTool } from "./xdd-rollback.ts";
import { createXddBlindJourneyTool } from "./xdd-blind-journey.ts";
import { createXddSubmitArtifactTool } from "./xdd-submit-artifact.ts";
import { createXddTraceTool } from "./xdd-trace.ts";
import { createXddHarnessGetTool } from "./xdd-harness-get.ts";
import { createXddHarnessSetTool } from "./xdd-harness-set.ts";

export function createXddTools(getState: GetXddState): ToolDefinition[] {
	return [
		createXddSubmitArtifactTool(getState),
		createXddAdvanceTool(getState),
		createXddObserveTool(getState),
		createXddDesiredStateTool(getState),
		createXddDifferenceTool(getState),
		createXddNextTaskTool(getState),
		createXddDiagnoseTool(getState),
		createXddRollbackTool(getState),
		createXddListSkillsTool(getState),
		createXddLoadSkillTool(getState),
		createXddTraceTool(getState),
		createXddHarnessGetTool(getState),
		createXddHarnessSetTool(getState),
		createXddBlindJourneyTool(getState),
	];
}
