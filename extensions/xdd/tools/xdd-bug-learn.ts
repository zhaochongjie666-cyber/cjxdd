import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { BUG_CATEGORIES, generatePreventionRule, recordBugLearning, type BugLearning } from "../bug-knowledge.ts";
import type { EmptyDetails, GetXddState } from "./index.ts";

const schema = Type.Object({
	category: Type.Union(BUG_CATEGORIES.map((value) => Type.Literal(value))),
	component: Type.String({ minLength: 8 }),
	symptom: Type.String({ minLength: 8 }),
	rootCause: Type.String({ minLength: 8 }),
	resolution: Type.String({ minLength: 8 }),
	prevention: Type.String({ minLength: 8 }),
	rollbackTarget: Type.Union([Type.Literal("spec"), Type.Literal("architecture"), Type.Literal("execute"), Type.Literal("resilience"), Type.Literal("verify")]),
	source: Type.Object({ kind: Type.Union([Type.Literal("runtime-incident"), Type.Literal("code-review"), Type.Literal("commit-review"), Type.Literal("qa"), Type.Literal("manual")]), id: Type.String({ minLength: 1 }) }),
	evidence: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});
type Input = Static<typeof schema>;

export function createXddBugLearnTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_bug_learn",
		label: "xdd: learn confirmed bug pattern",
		description: "在 Agent 完成根因分析、修复并取得证据后，记录可复用 bug pattern；重复模式自动累计并升级 prevention rule。不得用猜测代替 Agent 的根因推理。",
		parameters: schema,
		async execute(_toolCallId, params: Input): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			try {
				const pattern = recordBugLearning(state.cwd, params as BugLearning);
				const rule = generatePreventionRule(pattern);
				return { content: [{ type: "text", text: `✅ [xdd_bug_learn] 已记录 ${pattern.id}（累计 ${pattern.occurrences} 次）；预防规则 ${rule.id} 应进入 ${rule.gate} Gate，严重度 ${rule.severity}。` }], details: {} };
			} catch (error) {
				return { content: [{ type: "text", text: `❌ [xdd_bug_learn] ${(error as Error).message}` }], details: {} };
			}
		},
	};
}
