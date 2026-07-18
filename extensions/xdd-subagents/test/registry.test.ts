import { describe, expect, it } from "vitest";
import { discoverXddSubagents, findXddSubagent, parseAgentMarkdown, renderDelegationPrompt } from "../registry.ts";
import { PI_SUBAGENTS_PARITY, summarizeParity } from "../parity.ts";

describe("xdd subagent registry", () => {
	it("discovers builtin agents with positive and fallback roles", () => {
		const agents = discoverXddSubagents();
		expect(agents.map((agent) => agent.name)).toEqual(["xdd-context-builder", "xdd-delegate", "xdd-oracle", "xdd-planner", "xdd-researcher", "xdd-reviewer", "xdd-scout", "xdd-worker"]);
		expect(findXddSubagent("xdd-reviewer", agents)?.canEdit).toBe(false);
		expect(findXddSubagent("xdd-worker", agents)?.canEdit).toBe(true);
	});

	it("renders a delegation prompt with tool boundary and task", () => {
		const agent = findXddSubagent("xdd-scout");
		expect(agent).toBeTruthy();
		const prompt = renderDelegationPrompt(agent!, "检查认证流程");
		expect(prompt).toContain("# Delegate to xdd-scout");
		expect(prompt).toContain("执行模式：只读");
		expect(prompt).toContain("检查认证流程");
	});

	it("fails fast when required frontmatter is missing", () => {
		expect(() => parseAgentMarkdown("---\nname: bad\n---\nbody", "bad.md")).toThrow(/description/);
	});
	it("states explicitly that xdd-subagents is not a full pi-subagents clone", () => {
		const report = summarizeParity();
		expect(report).toContain("没有完全复刻 pi-subagents");
		expect(PI_SUBAGENTS_PARITY.some((item) => item.feature === "监督与 watchdog" && item.status === "partial")).toBe(true);
	});

});
