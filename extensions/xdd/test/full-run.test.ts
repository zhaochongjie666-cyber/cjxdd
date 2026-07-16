import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HeadlessXddController } from "../adapters/headless-controller.ts";
import { controllerInitScaffold, hasInitializedXddSkeleton } from "../init-scaffold.ts";
import { checkStagePathAccess } from "../policy/path-policy.ts";
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
