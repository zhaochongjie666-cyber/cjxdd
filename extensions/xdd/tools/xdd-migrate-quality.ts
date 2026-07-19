import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { createQualityMigration } from "../quality-migration.ts";
import type { EmptyDetails, GetXddState } from "./index.ts";

const schema = Type.Object({ actor: Type.String({ minLength: 1 }), reason: Type.String({ minLength: 20 }) });
type Input = Static<typeof schema>;

export function createXddMigrateQualityTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_migrate_quality",
		label: "xdd: migrate a legacy active run",
		description: "为升级前已经越过 plan 的旧 run 创建一次性、有审计记录的质量迁移。只豁免本应在当前阶段之前产生且无法追溯补造的工件；当前/未来审查仍必须执行。",
		parameters: schema,
		async execute(_toolCallId, params: Input): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			try {
				const manifest = createQualityMigration(state.cwd, params.actor, params.reason);
				return { content: [{ type: "text", text: `✅ [xdd_migrate_quality] 已迁移旧 run ${manifest.runId}；仅豁免：${manifest.waivers.join(", ")}。当前 ${manifest.detectedStage} 及后续质量检查仍严格执行。` }], details: {} };
			} catch (error) {
				return { content: [{ type: "text", text: `❌ [xdd_migrate_quality] ${(error as Error).message}` }], details: {} };
			}
		},
	};
}
