import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { HarnessStore, serializeHarnessYaml } from "../harness/store.ts";
import { probeHarnessFacts } from "../harness/probe.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

export function createXddHarnessGetTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_harness_get",
		label: "xdd: harness get",
		description: "读取规范化后的 .xdd/harness.yml 项目操作手册（环境/项目事实、验证命令、调试工具、调试任务、工作记忆）。",
		parameters: schema,
		execute(): AgentToolResult<EmptyDetails> {
			const state = getState();
			const store = new HarnessStore(state.cwd);
			let harness = store.load();
			if (Object.keys(harness.环境).length === 0 && Object.keys(harness.项目).length === 0) {
				harness = store.save({ ...harness, ...probeHarnessFacts(state.cwd) });
			}
			return ok(serializeHarnessYaml(harness));
		},
	};
}
