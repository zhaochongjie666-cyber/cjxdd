import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { formatAIGateResult, formatMechanicalCheckResult, runAIGate, type AIGateResult } from "./aigate.ts";

afterEach(() => vi.unstubAllGlobals());

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

	it("does not present an unavailable review as an all-pass verdict", () => {
		const result: AIGateResult = {
			passed: false,
			degraded: true,
			angles: [
				{ name: "偷工减料攻击", passed: "N/A", findings: [] },
				{ name: "AI味攻击", passed: "N/A", findings: [] },
			],
			issues: ["[AIGate LLM 调用失败] timeout"],
			suggestions: [],
		};
		const text = formatAIGateResult(result);
		expect(text).toContain("多角度攻击审查不可用：2/2 角度未获得判定");
		expect(text).toContain("⚠️ 偷工减料攻击: 审查未完成");
		expect(text).not.toContain("0/2 角度发现问题");
		expect(text).not.toContain("✅ 偷工减料攻击: 通过");
	});
});

describe("formatMechanicalCheckResult", () => {
	it("provides the passed mechanical-check observation as AI Gate input evidence", () => {
		const text = formatMechanicalCheckResult({ ok: true, reason: "已找到 rules.md", soft: false });
		expect(text).toContain("判定：通过");
		expect(text).toContain("模式：机械校验");
		expect(text).toContain("已找到 rules.md");
	});

	it("distinguishes an explicit soft pass from a hard verification", () => {
		const text = formatMechanicalCheckResult({ ok: true, soft: true });
		expect(text).toContain("软通过（未完成机械验证）");
		expect(text).toContain("无补充说明");
	});
});

describe("unified AI Gate", () => {
	it("makes a failed mechanical check fail the single AI Gate verdict even when the LLM says pass", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-aigate-"));
		writeFileSync(join(cwd, "artifact.md"), "real artifact content");
		let prompt = "";
		vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
			prompt = String(JSON.parse(String(init.body)).messages[1].content);
			return new Response(JSON.stringify({
				choices: [{ message: { content: JSON.stringify({
					passed: true,
					angles: [
						{ name: "机械检查结果", passed: true, findings: [] },
						{ name: "偷工减料攻击", passed: true, findings: [] },
						{ name: "AI味攻击", passed: true, findings: [] },
						{ name: "规格偏离攻击", passed: true, findings: [] },
					],
					issues: [],
					suggestions: [],
				}) } }],
			}));
		}));

		try {
			const result = await runAIGate({
				model: { api: "openai", baseUrl: "https://example.test", id: "test" } as any,
				apiKey: "test-key",
				stageName: "custom",
				aigateStandard: "test standard",
				artifactPaths: ["artifact.md"],
				mechanicalCheckResult: { ok: false, reason: "未找到必需产物" },
				cwd,
			});
			expect(prompt).toContain("机械检查结果");
			expect(prompt).toContain("未找到必需产物");
			expect(result.passed).toBe(false);
			expect(result.angles).toContainEqual({ name: "机械检查结果", passed: false, findings: ["未找到必需产物"] });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("does not coerce the string false into a passing angle", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-aigate-"));
		writeFileSync(join(cwd, "artifact.md"), "real artifact content");
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
			choices: [{ message: { content: JSON.stringify({
				passed: true,
				angles: [
					{ name: "机械检查结果", passed: true, findings: [] },
					{ name: "偷工减料攻击", passed: "false", findings: ["发现问题"] },
					{ name: "AI味攻击", passed: true, findings: [] },
					{ name: "规格偏离攻击", passed: true, findings: [] },
				],
				issues: [],
				suggestions: [],
			}) } }],
		}))));

		try {
			const result = await runAIGate({
				model: { api: "openai", baseUrl: "https://example.test", id: "test" } as any,
				apiKey: "test-key",
				stageName: "custom",
				aigateStandard: "test standard",
				artifactPaths: ["artifact.md"],
				mechanicalCheckResult: { ok: true },
				cwd,
			});
			expect(result.passed).toBe(false);
			expect(result.angles).toContainEqual({ name: "偷工减料攻击", passed: false, findings: ["发现问题"] });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("bounds architecture review request and response budgets", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-aigate-"));
		writeFileSync(join(cwd, "architecture.md"), "x".repeat(40_000));
		mkdirSync(join(cwd, ".xdd/design/spec"), { recursive: true });
		writeFileSync(join(cwd, ".xdd/design/spec/rules.md"), "y".repeat(40_000));
		let body: any;
		vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
			body = JSON.parse(String(init.body));
			return new Response(JSON.stringify({
				choices: [{ message: { content: JSON.stringify({
					passed: true,
					angles: ["机械检查结果", "偷工减料攻击", "AI味攻击", "规格偏离攻击", "安全攻击", "一致性攻击", "可运维攻击", "方案合理性攻击", "iter污染攻击"].map((name) => ({ name, passed: true, findings: [] })),
					issues: [], suggestions: [],
				}) } }],
			}));
		}));
		try {
			await runAIGate({
				model: { api: "openai", baseUrl: "https://example.test", id: "test" } as any,
				apiKey: "test-key", stageName: "architecture", aigateStandard: "test standard",
				artifactPaths: ["architecture.md"], mechanicalCheckResult: { ok: true }, cwd,
			});
			expect(body.max_tokens).toBe(12_000);
			expect(body.messages[1].content.length).toBeLessThan(75_000);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
