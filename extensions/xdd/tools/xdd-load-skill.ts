import { readFileSync } from "node:fs";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";
import { loadXddSkills } from "../skill-loader.ts";

const schema = Type.Object({
	name: Type.String({ description: "技能名（见 xdd_list_skills）" }),
});

export type XddLoadSkillInput = Static<typeof schema>;

/** xdd_load_skill: returns the full body of a named skill's SKILL.md. */
export function createXddLoadSkillTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_load_skill",
		label: "xdd: load skill",
		description: "按名加载某 xdd 技能的完整 SKILL.md 内容。",
		parameters: schema,
		async execute(_toolCallId, params: XddLoadSkillInput): Promise<AgentToolResult<EmptyDetails>> {
			const skill = skillsFromActiveRunOrCwd(getState).find((s) => s.name === params.name);
			if (!skill) {
				throw new Error(`[xdd_load_skill] 未找到技能: ${params.name}`);
			}
			const content = readFileSync(skill.filePath, "utf8");
			return ok(content);
		},
	};
}

function skillsFromActiveRunOrCwd(getState: GetXddState) {
	try {
		return getState().skills;
	} catch {
		// Skills are shared across flows. Loading a skill must not implicitly bind to
		// the xdd controller; fall back to cwd discovery only.
		return loadXddSkills(process.cwd());
	}
}
