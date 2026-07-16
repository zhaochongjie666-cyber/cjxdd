import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createXddTools } from "./tools/index.ts";
import { XddRunner } from "./runner.ts";
import { XddRunnerState, type XddRuntime, type XddRuntimeMessage } from "./types.ts";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/**
 * End-to-end: drive a full XddRunner.run() with a fake runtime that simulates
 * the model doing the work + calling submit_artifact + advance for every stage.
 * Proves the whole control loop (10 stages, per-stage gates, 4 group gates,
 * checkpoint, ledger, ESG) actually runs to completion.
 */

const DELIVERABLES: Record<string, Array<{ path: string; content: string }>> = {
	understand: [
		{ path: ".xdd/design/intent.md", content: "# Intent\n1 句话定位: auth service\n成功标准: login works\n非目标: sso\n" },
		{ path: ".xdd/design/design.md", content: "# Design\nSelected: email+password login\nAlternatives: oauth (太重)\nAssumptions: postgres\nOut of Scope: sso\nOpen Questions: none\n" },
		{ path: ".xdd/runs/iter-1/goals.md", content: "# Goals\n| G1 | login works | B01 |\n" },
		{ path: ".xdd/design/personas/_index.md", content: "# 用户角色全景\n## 角色清单\n| PX | 角色 | 定位 | 使用频率 | 系统产出 |\n|----|------|------|---------|---------|\n| P1 | 普通用户 | 登录 | 每日 | JWT |\n| P2 | 管理员 | 管权 | 按需 | 审计日志 |\n\n## 角色发散方法论记录（7 类逐一考量）\n1. 主用户: P1 普通用户\n2. 管理用户: P2 管理员\n3. 间接用户: 已考量，本系统无\n4. 外部系统: 已考量，本系统无\n5. 审计合规: 已考量，本系统无\n6. 开发运维: 已考量，本系统无\n7. 边缘角色: 已考量，本系统无\n" },
		{ path: ".xdd/design/personas/P1-普通用户.md", content: "# P1 普通用户\n## 1. 画像\n普通登录用户\n## 2. 目标与动机\n登录系统\n## 3. 使用频率与触发\n每日\n## 4. 典型工作流\n打开登录页 -> 输入账号密码 -> 登录\n## 5. 痛点\n无\n## 6. 系统产出\nJWT\n## 7. 权限范围\n只能登录\n## 8. 协作关系\n无\n## 9. 异常期望\n密码错提示\n## 10. 体验要求\n<1s 响应\n" },
		{ path: ".xdd/design/personas/P2-管理员.md", content: "# P2 管理员\n## 1. 画像\n系统管理员\n## 2. 目标与动机\n管理用户权限\n## 3. 使用频率与触发\n按需\n## 4. 典型工作流\n登录 -> 查看用户列表 -> 改权限\n## 5. 痛点\n无\n## 6. 系统产出\n权限变更审计\n## 7. 权限范围\n全部\n## 8. 协作关系\n管理 P1\n## 9. 异常期望\n操作日志\n## 10. 体验要求\n<2s 响应\n" },
	],
	spec: [
		{ path: ".xdd/design/spec/B01/rules.md", content: "# Rules\n| RXX | 规则 | Feature | 端点 | 实现 |\n| R01 | 邮箱密码登录 | login.feature | POST /api/auth/login | - [ ] |\n| R02 | 错误5次锁定 | lockout.feature | POST /api/auth/login | - [ ] |\n" },
		{ path: ".xdd/design/spec/B01/login.feature", content: "Feature: login\n  Scenario: ok\n  Scenario: 拒绝\n" },
	],
	architecture: [
		{ path: ".xdd/design/architecture/B01/architecture.md", content: "# Architecture\n模块: auth core\n依赖: db, mq\n数据流: req->svc->db\n失败模式: timeout\n" },
		{ path: ".xdd/design/architecture/module-landscape.md", content: "# Module Landscape\nbase: notify/storage/auth\n业务: B01/B02/B03\n反向依赖空\n" },
		{ path: ".xdd/design/architecture/event-contract.md", content: "# Event Contract\nE01 ProbeCompleted\nE02 AlertTriggered\n" },
		{ path: ".xdd/design/architecture/aggregate-landscape.md", content: "# Aggregate Landscape\nB01 Check / B02 AlertRule / B03 DashboardView\n" },
	],
	resilience: [
		{ path: ".xdd/design/architecture/B01/resilience/failure-modes.md", content: `# Failure Modes\n${"a".repeat(120)}` },
		{ path: ".xdd/design/architecture/B01/resilience/failsafe-design.md", content: "# Failsafe\n| F01 | 熳断 | app/svc.py |\n" },
		{ path: ".xdd/design/architecture/B01/resilience/resilience-test-plan.md", content: "# Test Plan\n| F01 | chaos | manual |\n" },
	],
	wire: [
		{ path: ".xdd/design/wire/login.md", content: "# Login Page\n## 布局\n[登录表单]\n## 6态\n- 空: 输入框空\n- 加载: 提交中\n- 错误: 密码错\n- 成功: 跳转\n- 确认: 记住我\n- 边界: 超长输入\n## Review\nQ1: 按钮存在 ✅\n" },
	],
	plan: [
		{ path: ".xdd/runs/iter-1/plan/B01/plan.md", content: `# Plan\n${"b".repeat(120)}` },
	],
	execute: [
		{ path: "src/auth.ts", content: "// @implements R01\nexport function login(email: string, pw: string) { return { token: \"x\" }; }\n" },
	],
	verify: [
		{ path: ".xdd/runs/iter-1/verify-report.md", content: "# Verify Report\n## 健康检查\nGET /healthz -> 200\n## 漫游\n注册->登录->token: ok\n## 全链路审计\n| spec RXX | 1 | 1 | ✅ |\n## 双契约\n真实可用: ✅\n生产接受: ✅\n## 结论\n真能用\n" },
	],
};

class FakeRuntime implements XddRuntime {
	private messages: XddRuntimeMessage[] = [];
	readonly entries: Array<{ type: string; data: unknown }> = [];
	activeTools: string[] = [];

	constructor(
		private readonly state: XddRunnerState,
		private readonly tools: Map<string, ToolDefinition>,
		private readonly cwd: string,
	) {}

	appendCustomEntry(type: string, data: unknown): void {
		this.entries.push({ type, data });
	}
	getMessages(): ReadonlyArray<XddRuntimeMessage> {
		return this.messages;
	}
	setActiveToolsByName(tools: string[]): void {
		this.activeTools = tools;
	}

	async prompt(_seed: string): Promise<void> {
		const stage = this.state.currentStage();
		if (!stage) throw new Error("fake: no current stage");

		// Simulate the model doing the work: write the stage's deliverable file.
		const del = DELIVERABLES[stage.name];
		if (del) {
			for (const f of del) {
				mkdirSync(join(this.cwd, dirname(f.path)), { recursive: true });
				writeFileSync(join(this.cwd, f.path), f.content, "utf8");
			}
		}

		// Simulate the model calling xdd_submit_artifact (triggers the real gate).
		const submit = this.tools.get("xdd_submit_artifact") as ToolDefinition;
		const isVerify = stage.exit === "verdict";
		await submit.execute("tc", {
			summary: `${stage.name} 阶段完成`,
			artifacts: stage.deliverablePaths.length > 0 ? stage.deliverablePaths : [],
			selfAttack: "检查了边界与异常路径，确认无遗漏的反例与风险",
			...(isVerify ? { pass: true } : {}),
		});

		// Simulate the model calling xdd_advance (runs group gate at group end).
		const advance = this.tools.get("xdd_advance") as ToolDefinition;
		await advance.execute("tc", {});

		// Record a fake assistant usage message so computeTokens() has something.
		this.messages.push({ role: "assistant", usage: { totalTokens: 100 } });
	}
}

describe("XddRunner end-to-end", () => {
	it("runs all 10 stages to completion with every gate passing", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-e2e-"));
		try {
			// Phase 5 (E.6): requireTestsPass and the new runBuild now run
			// real commands. The E2E fixture must provide a passing test
			// command so Gate 3 / verify's tests actually run.
			writeFileSync(join(cwd, "package.json"), JSON.stringify({
				name: "xdd-e2e",
				version: "0.0.0",
				scripts: { test: "echo ok", build: "echo ok" },
			}));
			const state = new XddRunnerState({ runId: "e2e", cwd, userInput: "build me a tiny auth service" });
			const toolsArray = createXddTools(() => state);
			const tools = new Map(toolsArray.map((t) => [t.name, t]));
			const runtime = new FakeRuntime(state, tools, cwd);
			const runner = new XddRunner(runtime, state, {
				task: "build me a tiny auth service",
				maxRollbacksPerStage: 2,
				maxSelfHealPerStage: 3,
			});

			const result = await runner.run();

			// Run completed successfully.
			expect(result.status).toBe("ok");
			expect(result.runId).toBe("e2e");
			expect(result.finalStage).toBe("verify");
			expect(result.rollbacks).toBe(0);

			// Every stage recorded a pass in the ledger.
			const passes = state.ledger.filter((e) => e.status === "pass" && !e.superseded);
			expect(passes.length).toBe(10);

			// ESG accumulated nodes across the run (decisions/evidence/reviews/tasks).
			expect(state.esg.length).toBeGreaterThan(0);

			// All deliverable files actually landed on disk (the gates checked these).
			for (const name of ["understand", "spec", "architecture", "resilience", "plan", "execute", "verify"]) {
				for (const f of DELIVERABLES[name]) {
					expect(existsSync(join(cwd, f.path))).toBe(true);
				}
			}

			// File-first: runtime.json persists after success (holds ledger/ESG).
			// runComplete=true prevents readCheckpoint from offering resume.
			const rtPath = join(cwd, ".xdd", "runtime.json");
			if (existsSync(rtPath)) {
				const { readFileSync } = await import("node:fs");
				const rt = JSON.parse(readFileSync(rtPath, "utf8"));
				expect(rt.runComplete).toBe(true);
			}
		} finally {
			rmSync(cwd, { recursive: true });
		}
	}, 15000);

	it("fails the spec stage when the deliverable is missing and reflection does not recover", async () => {
		// A runtime that NEVER writes the deliverable: spec's gate will fail every
		// submit, self-heal budget exhausts, reflection runs, no rollback offered
		// -> run fails.
		const cwd = mkdtempSync(join(tmpdir(), "xdd-e2e-fail-"));
		try {
			const state = new XddRunnerState({ runId: "fail", cwd, userInput: "u" });
			const toolsArray = createXddTools(() => state);
			const tools = new Map(toolsArray.map((t) => [t.name, t]));

			// Runtime that only does soft-pass stages (init/understand) then gets
			// stuck at spec (no file written -> gate fails).
			const stuck: XddRuntime = {
				appendCustomEntry: () => {},
				getMessages: () => [],
				setActiveToolsByName: () => {},
				async prompt() {
					const stage = state.currentStage();
					if (!stage) return;
					const submit = tools.get("xdd_submit_artifact") as ToolDefinition;
					try {
						await submit.execute("tc", {
							summary: "x",
							artifacts: [],
							selfAttack: "未发现明显反例但未产出文件",
						});
					} catch {
						// gate failure thrown by submit - swallow, model would retry
					}
				},
			};
			const runner = new XddRunner(stuck, state, { task: "u", maxRollbacksPerStage: 2, maxSelfHealPerStage: 2 });

			const result = await runner.run();
			expect(result.status).toBe("failed");
		} finally {
			rmSync(cwd, { recursive: true });
		}
	}, 20000);
});
