import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";
import { loadXddSkills } from "../skill-loader.ts";

const schema = Type.Object({});

/** xdd_list_skills: lists available xdd/stage skills. */
export function createXddListSkillsTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_list_skills",
		label: "xdd: list skills",
		description: "列出可用的 xdd 阶段技能（SKILL.md），返回 name / description / location。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const skills = skillsFromActiveRunOrCwd(getState);
			if (skills.length === 0) {
				return ok("（无可用技能）");
			}
			const lines = skills.map((s) => `- ${s.name}: ${s.description} [${s.filePath}]`);
			return ok(["可用技能：", ...lines].join("\n"));
		},
	};
}

function skillsFromActiveRunOrCwd(getState: GetXddState) {
	try {
		return getState().skills;
	} catch {
		// Skills are shared across xdd and Normal Flow; listing them must not depend
		// on the xdd controller being active. Fall back to cwd discovery without
		// touching any controller/runtime state.
		return loadXddSkills(process.cwd());
	}
}
