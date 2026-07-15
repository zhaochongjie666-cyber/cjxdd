import { describe, it, expect } from "vitest";
import { formatAIGateResult, type AIGateResult } from "./aigate.ts";

describe("formatAIGateResult", () => {
	it("formats multi-angle breakdown with failed angles first", () => {
		const result: AIGateResult = {
			passed: false,
			angles: [
				{ name: "偷工减料攻击", passed: false, findings: ["发现占位符 TODO", "测试只测 happy path"] },
				{ name: "AI味攻击", passed: true, findings: [] },
				{ name: "安全攻击", passed: false, findings: ["认证方案缺失"] },
				{ name: "规格偏离攻击", passed: true, findings: [] },
			],
			issues: [],
			suggestions: ["补完 TODO", "加认证中间件"],
		};
		const text = formatAIGateResult(result);
		expect(text).toContain("2/4 角度发现问题");
		expect(text).toContain("❌ 偷工减料攻击:");
		expect(text).toContain("发现占位符 TODO");
		expect(text).toContain("❌ 安全攻击:");
		expect(text).toContain("认证方案缺失");
		expect(text).toContain("✅ AI味攻击: 通过");
		expect(text).toContain("✅ 规格偏离攻击: 通过");
	});

	it("handles no angle breakdown (fallback)", () => {
		const result: AIGateResult = {
			passed: false,
			angles: [],
			issues: ["简单问题1", "简单问题2"],
			suggestions: [],
		};
		const text = formatAIGateResult(result);
		expect(text).toContain("1. 简单问题1");
		expect(text).toContain("2. 简单问题2");
	});

	it("handles all angles passed", () => {
		const result: AIGateResult = {
			passed: true,
			angles: [
				{ name: "偷工减料攻击", passed: true, findings: [] },
				{ name: "AI味攻击", passed: true, findings: [] },
			],
			issues: [],
			suggestions: [],
		};
		const text = formatAIGateResult(result);
		expect(text).toContain("0/2 角度发现问题");
		expect(text).toContain("✅ 偷工减料攻击: 通过");
		expect(text).toContain("✅ AI味攻击: 通过");
	});
});
