import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HeadlessXddController } from "../adapters/headless-controller.ts";
import { formatAIGateResult, type AIGateResult } from "../aigate.ts";
import { evaluateVerifyEvidenceGate } from "../evidence/verify-gate.ts";
import { controllerInitScaffold, hasInitializedXddSkeleton } from "../init-scaffold.ts";
import { checkStagePathAccess } from "../policy/path-policy.ts";
import { STAGE_GROUPS } from "../stage-groups.ts";
import { STAGES } from "../stages.ts";
import type { RuntimeStateV2 } from "../storage/runtime-migrations.ts";

function tmpCwd(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function stageName(state: RuntimeStateV2): string | undefined {
	return state.plan[state.planIndex]?.stageName;
}

function startLikeProduction(cwd: string, task = "t13 task") {
	const existedBeforeScaffold = hasInitializedXddSkeleton(cwd);
	controllerInitScaffold(cwd);
	const initialStage = existedBeforeScaffold ? "understand" : "init";
	const headless = new HeadlessXddController(cwd);
	const result = headless.dispatch({ type: "START", task, options: { cwd, runId: "t13", initialStage } });
	return { headless, result, existedBeforeScaffold };
}

describe("T13 full run regression", () => {
	it("starts empty repositories at init, then advances to understand", () => {
		const cwd = tmpCwd("xdd-full-empty-");
		try {
			expect(hasInitializedXddSkeleton(cwd)).toBe(false);
			const { headless, result, existedBeforeScaffold } = startLikeProduction(cwd);
			expect(existedBeforeScaffold).toBe(false);
			expect(existsSync(join(cwd, ".xdd", "design"))).toBe(true);
			expect(existsSync(join(cwd, ".xdd", "runs"))).toBe(true);
			expect(stageName(result.state)).toBe("init");

			headless.dispatch({ type: "SUBMIT", submission: { summary: "init pass", artifacts: [], selfAttack: "fixture checked", pass: true } });
			const advanced = headless.dispatch({ type: "ADVANCE" });
			expect(stageName(advanced.state)).toBe("understand");
			expect(advanced.state.stageOutcome).toBe("advanced");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("does not overwrite initialized repositories and starts at understand", () => {
		const cwd = tmpCwd("xdd-full-legacy-");
		try {
			mkdirSync(join(cwd, ".xdd", "design"), { recursive: true });
			mkdirSync(join(cwd, ".xdd", "runs"), { recursive: true });
			const sentinel = join(cwd, ".xdd", "design", "intent.md");
			writeFileSync(sentinel, "keep me", "utf8");

			const { result, existedBeforeScaffold } = startLikeProduction(cwd);
			expect(existedBeforeScaffold).toBe(true);
			expect(readFileSync(sentinel, "utf8")).toBe("keep me");
			expect(stageName(result.state)).toBe("understand");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("requires human approval before understand advances to spec", () => {
		const cwd = tmpCwd("xdd-full-approval-");
		try {
			controllerInitScaffold(cwd);
			const headless = new HeadlessXddController(cwd);
			headless.dispatch({ type: "START", task: "approval", options: { cwd, runId: "approval", initialStage: "understand" } });
			headless.dispatch({ type: "SUBMIT", submission: { summary: "understood", artifacts: [], selfAttack: "fixture checked", pass: true } });
			const waiting = headless.dispatch({ type: "ADVANCE" });
			expect(waiting.state.status).toBe("awaiting_approval");
			expect(stageName(waiting.state)).toBe("understand");

			const approved = headless.dispatch({ type: "APPROVE", approvalId: "understand" });
			expect(approved.state.status).toBe("running");
			expect(stageName(approved.state)).toBe("spec");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("classifies provider errors without consuming gate attempts or sending xdd followups", () => {
		const cwd = tmpCwd("xdd-full-provider-");
		try {
			const { headless } = startLikeProduction(cwd);
			const before = headless.load()?.selfHealUsed?.init ?? 0;
			const result = headless.dispatch({ type: "AGENT_ENDED", stopReason: "error", providerError: "rate limit" });
			expect(result.state.stageOutcome).toBe("provider_error");
			expect(result.state.lastStageError).toBe("rate limit");
			expect(result.effects).toHaveLength(0);
			expect(result.state.selfHealUsed?.init ?? 0).toBe(before);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects sham verify reports that cite missing evidence", () => {
		const cwd = tmpCwd("xdd-full-sham-verify-");
		try {
			mkdirSync(join(cwd, ".xdd", "runs", "iter-1", "plan", "task"), { recursive: true });
			mkdirSync(join(cwd, ".xdd", "runs", "iter-1", "evidence"), { recursive: true });
			writeFileSync(join(cwd, ".xdd", "runs", "iter-1", "plan", "task", "plan.md"), "- [x] verify真实证据\n", "utf8");
			writeFileSync(
				join(cwd, ".xdd", "runs", "iter-1", "verify-report.md"),
				[
					"# Verify",
					"Runtime evidence: npm test exit code 0.",
					"HTTP evidence: curl GET /api/orders status 200.",
					"Evidence .xdd/runs/iter-1/evidence/missing-runtime.txt",
					"这是一份伪造报告，正文很长但引用的证据文件不存在。".repeat(40),
				].join("\n"),
				"utf8",
			);

			const result = evaluateVerifyEvidenceGate(cwd);
			expect(result.ok).toBe(false);
			expect(result.failure?.code).toBe("EVIDENCE_MISSING");
			expect(result.failure?.message).toContain("missing-runtime.txt");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("keeps diagnosis and rollback recovery on the Controller path", () => {
		const cwd = tmpCwd("xdd-full-rollback-");
		try {
			controllerInitScaffold(cwd);
			const headless = new HeadlessXddController(cwd);
			headless.dispatch({ type: "START", task: "rollback", options: { cwd, runId: "rollback", initialStage: "architecture" } });

			const diagnosed = headless.dispatch({
				type: "DIAGNOSE",
				diagnosis: { layer: "architecture-flaw", reason: "Gate 2 发现架构产物不一致" },
			});
			expect(diagnosed.state.status).toBe("reflecting");
			expect(diagnosed.state.diagnose?.layer).toBe("architecture-flaw");

			const rolledBack = headless.dispatch({ type: "ROLLBACK", target: "spec", reason: "diagnosis requires spec repair" });
			expect(rolledBack.state.status).toBe("running");
			expect(stageName(rolledBack.state)).toBe("spec");
			expect(rolledBack.state.stageOutcome).toBe("advanced");
			expect(rolledBack.state.rollbackOutcome).toContain("spec");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("surfaces degraded AI Gate results as blocking review text", () => {
		const degraded: AIGateResult = {
			passed: false,
			degraded: true,
			angles: [{ name: "偷工减料攻击", passed: false, findings: ["[AIGate 响应未包含 JSON]"] }],
			issues: ["[AIGate 解析失败] LLM 响应未找到 JSON 块"],
			suggestions: ["重试"],
		};

		expect(degraded.degraded).toBe(true);
		expect(degraded.passed).toBe(false);
		expect(formatAIGateResult(degraded)).toContain("❌ 偷工减料攻击");
	});

	it("keeps group gate rollback atomic when discovery artifacts are missing", async () => {
		const cwd = tmpCwd("xdd-full-group-gate-");
		try {
			controllerInitScaffold(cwd);
			const discovery = STAGE_GROUPS.find((group) => group.name === "discovery")!;
			const gate = await discovery.gate({ cwd });
			expect(gate.ok).toBe(false);
			expect(discovery.rollbackTarget).toBe("init");

			const headless = new HeadlessXddController(cwd);
			headless.dispatch({ type: "START", task: "group gate", options: { cwd, runId: "group", initialStage: "spec" } });
			const rolledBack = headless.dispatch({ type: "ROLLBACK", target: discovery.rollbackTarget, reason: gate.reason ?? "group gate failed" });
			expect(stageName(rolledBack.state)).toBe("init");
			expect(rolledBack.state.rollbackOutcome).toContain("init");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("keeps verify path policy from writing source files", () => {
		const cwd = tmpCwd("xdd-full-policy-");
		try {
			const verify = STAGES.find((stage) => stage.name === "verify")!;
			expect(checkStagePathAccess(cwd, verify, "src/x.ts", "write").ok).toBe(false);
			expect(checkStagePathAccess(cwd, verify, ".xdd/runs/iter-1/evidence/out.txt", "write").ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
