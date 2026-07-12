import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildTraceCoverage, observeFilesystem } from "../observe-fs.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";

const schema = Type.Object({});

/**
 * xdd_trace: trace-chain coverage. Reads the real disk and reports how the spec
 * RXX rules line up with code @implements markers - which rules are implemented,
 * which are unimplemented, which code markers are orphans (no matching spec).
 *
 * This is the追溯闭环 health view (design -> RXX -> @implements). It does not
 * depend on runner state - pure filesystem observation - so it works at any
 * point to surface trace gaps before verify catches them.
 */
export function createXddTraceTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_trace",
		label: "xdd: trace-chain coverage",
		description:
			"追溯链覆盖: spec 的 RXX 规则 vs 代码 @implements RXX 标注。返回哪些 RXX 已在代码落实、哪些只在 spec 未实现、哪些代码标注是孤儿（无对应 spec）。xdd 追溯闭环（design -> RXX -> @implements）的健康度视图，任意时刻可查。",
		parameters: schema,
		async execute(): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const stage = state.currentStage();
			if (!stage) return ok("[xdd_trace] 无活跃 run。");
			const snap = observeFilesystem(state.cwd, []);
			const cov = buildTraceCoverage(snap);
			const lines = [
				`run: ${state.runId}`,
				"追溯链覆盖 (RXX -> feature -> @implements):",
				`spec RXX: ${cov.specRxx.length} 条${cov.specRxx.length > 0 ? ` (${cov.specRxx.join(", ")})` : ""}`,
				`feature 文件: ${cov.featureFiles} 个`,
				`代码 @implements: ${cov.implementedRxx.length} 个 RXX${cov.implementedRxx.length > 0 ? ` (${cov.implementedRxx.join(", ")})` : ""}`,
			];
			if (cov.specRxx.length === 0 && cov.implementedRxx.length === 0) {
				lines.push("", "(无 .xdd spec 也无 @implements 标注：非 xdd 项目或尚未开始)");
			} else {
				if (cov.unimplemented.length > 0) {
					lines.push("", `未实现（spec 有、代码无 @implements）: ${cov.unimplemented.join(", ")}`);
				}
				if (cov.orphan.length > 0) {
					lines.push("", `孤儿标注（代码有 @implements、spec 无对应 RXX）: ${cov.orphan.join(", ")}`);
				}
				if (cov.unimplemented.length === 0 && cov.orphan.length === 0) {
					lines.push("", "追溯链完整：spec RXX 与代码 @implements 一一对应。");
				}
			}
			return ok(lines.join("\n"));
		},
	};
}
