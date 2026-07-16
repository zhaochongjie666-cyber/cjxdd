import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { HarnessStore, serializeHarnessYaml } from "../harness/store.ts";
import type { HarnessOperation, HarnessSection } from "../harness/schema.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({
	section: Type.Union([
		Type.Literal("验证命令"),
		Type.Literal("调试工具"),
		Type.Literal("调试任务"),
		Type.Literal("工作记忆"),
		Type.Literal("项目"),
		Type.Literal("环境"),
	]),
	operation: Type.Union([Type.Literal("replace"), Type.Literal("append"), Type.Literal("remove"), Type.Literal("merge")]),
	value: Type.Any(),
});

export type XddHarnessSetInput = Static<typeof schema>;

export function createXddHarnessSetTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_harness_set",
		label: "xdd: harness set",
		description: "更新 .xdd/harness.yml 项目操作手册。section=验证命令/调试工具/调试任务/工作记忆/项目/环境，operation=replace/append/remove/merge。",
		parameters: schema,
		execute(_toolCallId, params: XddHarnessSetInput): AgentToolResult<EmptyDetails> {
			const state = getState();
			const harness = new HarnessStore(state.cwd).update(params.section as HarnessSection, params.operation as HarnessOperation, params.value);
			return ok(`[xdd_harness_set] 已更新 ${params.section}/${params.operation}\n\n${serializeHarnessYaml(harness)}`);
		},
	};
}
