import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { fauxAssistantMessage, registerFauxProvider, resetApiProviders, type Context, type StreamOptions } from "@earendil-works/pi-ai/compat";
import { formatAIGateResult, formatMechanicalCheckResult, runAIGate, validateStageAttackAngles, type AIGateResult } from "./aigate.ts";

afterEach(() => {
	vi.unstubAllGlobals();
	resetApiProviders();
});

describe("AIGate attack-angle catalog", () => {
	it("does not register duplicate angle names within a stage", () => {
		expect(() => validateStageAttackAngles()).not.toThrow();
	});
});


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
	function createCwd(): string {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-aigate-"));
		writeFileSync(join(cwd, "artifact.md"), "real artifact content");
		return cwd;
	}

	function verdict(angleNames = ["机械检查结果", "偷工减料攻击", "AI味攻击", "规格偏离攻击"]): string {
		return JSON.stringify({
			passed: true,
			angles: angleNames.map((name) => ({ name, passed: true, findings: [] })),
			issues: [],
			suggestions: [],
		});
	}

	function fauxModelWithResponses(responses: string[]) {
		const faux = registerFauxProvider({ tokensPerSecond: 0 });
		faux.setResponses(responses.map((text) => fauxAssistantMessage(text)));
		return faux.getModel();
	}

	it("parses the first balanced JSON object when the response contains extra objects", async () => {
		const cwd = createCwd();
		const model = fauxModelWithResponses([`审查完成。\n${verdict()}\n调试数据：${JSON.stringify({ ignored: true })}`]);
		try {
			const result = await runAIGate({ model, apiKey: "test-key", stageName: "custom", aigateStandard: "test standard", artifactPaths: ["artifact.md"], mechanicalCheckResult: { ok: true }, cwd });
			expect(result.passed).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("retries once with a format correction after malformed JSON", async () => {
		const cwd = createCwd();
		const faux = registerFauxProvider({ tokensPerSecond: 0 });
		faux.setResponses([fauxAssistantMessage('{"passed": true "angles": []}'), fauxAssistantMessage(verdict())]);
		try {
			const result = await runAIGate({ model: faux.getModel(), apiKey: "test-key", stageName: "custom", aigateStandard: "test standard", artifactPaths: ["artifact.md"], mechanicalCheckResult: { ok: true }, cwd });
			expect(result.passed).toBe(true);
			expect(faux.state.callCount).toBe(2);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("makes a failed mechanical check fail the single AI Gate verdict even when the LLM says pass", async () => {
		const cwd = createCwd();
		let prompt = "";
		const faux = registerFauxProvider({ tokensPerSecond: 0 });
		faux.setResponses([(_context: Context) => {
			prompt = String(_context.messages[0]?.role === "user" ? _context.messages[0].content : "");
			return fauxAssistantMessage(verdict());
		}]);
		try {
			const result = await runAIGate({ model: faux.getModel(), apiKey: "test-key", stageName: "custom", aigateStandard: "test standard", artifactPaths: ["artifact.md"], mechanicalCheckResult: { ok: false, reason: "未找到必需产物" }, cwd });
			expect(prompt).toContain("机械检查结果");
			expect(prompt).toContain("未找到必需产物");
			expect(result.passed).toBe(false);
			expect(result.angles).toContainEqual({ name: "机械检查结果", passed: false, findings: ["未找到必需产物"] });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("does not coerce the string false into a passing angle", async () => {
		const cwd = createCwd();
		const badVerdict = JSON.stringify({
			passed: true,
			angles: [
				{ name: "机械检查结果", passed: true, findings: [] },
				{ name: "偷工减料攻击", passed: "false", findings: ["发现问题"] },
				{ name: "AI味攻击", passed: true, findings: [] },
				{ name: "规格偏离攻击", passed: true, findings: [] },
			],
			issues: [], suggestions: [],
		});
		const model = fauxModelWithResponses([badVerdict]);
		try {
			const result = await runAIGate({ model, apiKey: "test-key", stageName: "custom", aigateStandard: "test standard", artifactPaths: ["artifact.md"], mechanicalCheckResult: { ok: true }, cwd });
			expect(result.passed).toBe(false);
			expect(result.angles).toContainEqual({ name: "偷工减料攻击", passed: false, findings: ["发现问题"] });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("uses pi-ai complete with plain turn context and provider options", async () => {
		const cwd = createCwd();
		mkdirSync(join(cwd, ".xdd/design/spec"), { recursive: true });
		writeFileSync(join(cwd, ".xdd/design/spec/rules.md"), "y".repeat(40_000));
		let seenContext: Context | undefined;
		let seenOptions: StreamOptions | undefined;
		const faux = registerFauxProvider({ tokensPerSecond: 0 });
		faux.setResponses([(context: Context, options: StreamOptions | undefined) => {
			seenContext = context;
			seenOptions = options;
			return fauxAssistantMessage(verdict(["机械检查结果", "偷工减料攻击", "AI味攻击", "规格偏离攻击", "安全攻击", "一致性攻击", "可运维攻击", "方案合理性攻击", "iter污染攻击"]));
		}]);
		try {
			const result = await runAIGate({ model: faux.getModel(), apiKey: "test-key", headers: { "x-extra": "1" }, stageName: "architecture", aigateStandard: "test standard", artifactPaths: ["artifact.md"], mechanicalCheckResult: { ok: true }, cwd });
			expect(result.passed).toBe(true);
			expect(seenContext?.systemPrompt).toContain("多角度攻击审查者");
			expect(String(seenContext?.messages[0]?.role === "user" ? seenContext.messages[0].content : "")).toContain("y".repeat(40_000));
			expect(seenOptions).toMatchObject({ apiKey: "test-key", headers: { "x-extra": "1" }, temperature: 0, maxRetries: 0 });
			expect((seenOptions as Record<string, unknown>).maxTokens).toBeUndefined();
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("preserves header-only auth and forwards provider env", async () => {
		const cwd = createCwd();
		let seenOptions: StreamOptions | undefined;
		const faux = registerFauxProvider({ tokensPerSecond: 0 });
		faux.setResponses([(_context: Context, options: StreamOptions | undefined) => {
			seenOptions = options;
			return fauxAssistantMessage(verdict());
		}]);
		try {
			const result = await runAIGate({ model: faux.getModel(), apiKey: "test-key", headers: { "api-key": "header-key", "x-extra": "1" }, env: { CLOUDFLARE_ACCOUNT_ID: "acct" }, stageName: "custom", aigateStandard: "test standard", artifactPaths: ["artifact.md"], mechanicalCheckResult: { ok: true }, cwd });
			expect(result.passed).toBe(true);
			expect(seenOptions).toMatchObject({ headers: { "api-key": "header-key", "x-extra": "1" }, env: { CLOUDFLARE_ACCOUNT_ID: "acct" } });
			expect((seenOptions as Record<string, unknown>).apiKey).toBeUndefined();
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("surfaces pi-ai complete error messages as degraded review failures", async () => {
		const cwd = createCwd();
		const faux = registerFauxProvider({ tokensPerSecond: 0 });
		faux.setResponses([
			fauxAssistantMessage([], { stopReason: "error", errorMessage: "upstream 504" }),
			fauxAssistantMessage([], { stopReason: "error", errorMessage: "upstream 504" }),
		]);
		try {
			const result = await runAIGate({ model: faux.getModel(), apiKey: "test-key", stageName: "custom", aigateStandard: "test standard", artifactPaths: ["artifact.md"], mechanicalCheckResult: { ok: true }, cwd });
			expect(result.degraded).toBe(true);
			expect(result.issues.join("\n")).toContain("upstream 504");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
