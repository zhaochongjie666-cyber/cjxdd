import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../../core/extensions/types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

/** xdd_list_skills: lists available xdd/stage skills. */
export function createXddListSkillsTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_list_skills",
		label: "xdd: list skills",
		description: "列出可用的 xdd 阶段技能（SKILL.md），返回 name / description / location。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const skills = state.skills;
			if (skills.length === 0) {
				return ok("（无可用技能）");
			}
			const lines = skills.map((s) => `- ${s.name}: ${s.description} [${s.filePath}]`);
			return ok(["可用技能：", ...lines].join("\n"));
		},
	};
}
