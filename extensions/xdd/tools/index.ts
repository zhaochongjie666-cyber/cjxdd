import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "../../core/extensions/types.ts";
import type { XddRunnerState } from "../types.ts";

export type EmptyDetails = Record<string, never>;

export function ok(text: string): AgentToolResult<EmptyDetails> {
	return { content: [{ type: "text", text }], details: {} };
}

export type GetXddState = () => XddRunnerState;

import { createXddAdvanceTool } from "./xdd-advance.ts";
import { createXddDiagnoseTool } from "./xdd-diagnose.ts";
import { createXddGoalCompleteTool } from "./xdd-goal-complete.ts";
import { createXddListSkillsTool } from "./xdd-list-skills.ts";
import { createXddLoadSkillTool } from "./xdd-load-skill.ts";
import { createXddRollbackTool } from "./xdd-rollback.ts";
import { createXddStatusTool } from "./xdd-status.ts";
import { createXddVerdictTool } from "./xdd-verdict.ts";

export function createXddTools(getState: GetXddState): ToolDefinition[] {
	return [
		createXddGoalCompleteTool(getState),
		createXddVerdictTool(getState),
		createXddAdvanceTool(getState),
		createXddDiagnoseTool(getState),
		createXddRollbackTool(getState),
		createXddStatusTool(getState),
		createXddListSkillsTool(getState),
		createXddLoadSkillTool(getState),
	];
}
