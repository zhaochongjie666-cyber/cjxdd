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
	],
	spec: [
		{ path: ".xdd/design/spec/B01/rules.md", content: "# Rules\n| RXX | 规则 | Feature | 端点 | 实现 |\n| R01 | 邮箱密码登录 | login.feature | POST /api/auth/login | - [ ] |\n| R02 | 错误5次锁定 | lockout.feature | POST /api/auth/login | - [ ] |\n" },
		{ path: ".xdd/design/spec/B01/login.feature", content: "Feature: login\n  Scenario: ok\n  Scenario: 拒绝\n" },
	],
	architecture: [
		{ path: ".xdd/design/architecture/B01/architecture.md", content: "# Architecture\n模块: auth core\n依赖: db, mq\n数据流: req->svc->db\n失败模式: timeout\n" },
	],
	resilience: [
		{ path: ".xdd/design/architecture/B01/resilience/failure-modes.md", content: `# Failure Modes\n${"a".repeat(120)}` },
		{ path: ".xdd/design/architecture/B01/resilience/failsafe-design.md", content: "# Failsafe\n| F01 | 熳断 | app/svc.py |\n" },
		{ path: ".xdd/design/architecture/B01/resilience/resilience-test-plan.md", content: "# Test Plan\n| F01 | chaos | manual |\n" },
	],
	plan: [
		{ path: ".xdd/runs/iter-1/plan/B01/plan.md", content: `# Plan\n${"b".repeat(120)}` },
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
			for (const name of ["understand", "spec", "architecture", "resilience", "plan"]) {
				for (const f of DELIVERABLES[name]) {
					expect(existsSync(join(cwd, f.path))).toBe(true);
				}
			}

			// Checkpoint was cleared on success (P5 Recoverability: removeCheckpoint empties the file).
			const cpPath = join(cwd, ".xdd", "checkpoint.json");
			if (existsSync(cpPath)) {
				const { statSync } = await import("node:fs");
				expect(statSync(cpPath).size).toBe(0);
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
