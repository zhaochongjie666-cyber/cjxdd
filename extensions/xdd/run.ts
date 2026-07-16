/**
 * xdd run command handlers -- the missing production entry point.
 *
 * Architecture B: pi's REPL IS the runner loop. The /xdd command creates the
 * state + loads skills + activates the extension (so tools/hooks work) + sends
 * the task as a user message. before_agent_start sets the stage prompt; the
 * tools (xdd_submit_artifact / xdd_advance) drive state transitions.
 *
 * No separate XddRunner.run() loop is needed -- pi's turn cycle replaces it.
 */
import { STAGES } from "./stages.ts";
import { XddRunnerState } from "./types.ts";
import { activateXddExtension, getState } from "./extension.ts";
import { loadXddSkills } from "./skill-loader.ts";
import { readCheckpoint, writeCheckpoint } from "./checkpoint.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { archiveRun } from "./archive.ts";
import { controllerInitScaffold } from "./init-scaffold.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** /xdd <task> -- start a new xdd run. */
export async function runXdd(args: string, cwd: string, pi: ExtensionAPI): Promise<void> {
	const task = args.trim();
	if (!task) {
		await pi.sendUserMessage("[xdd] 用法: /xdd <任务描述>，例如 /xdd 构建一个认证服务");
		return;
	}
	const runId = `xdd-${Date.now()}`;
	// Phase 4 (F.5): Controller scaffold runs BEFORE state creation so
	// the init stage sees a fully-prepared .xdd/ tree.
	const scaffold = controllerInitScaffold(cwd);
	const state = new XddRunnerState({ runId, cwd, userInput: task });
	state.skills = loadXddSkills(cwd);
	state.plan = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	state.startRun();
	// Skip init if .xdd/ skeleton already exists (re-run or resumed project).
	const xddExists = existsSync(join(cwd, ".xdd", "design")) && existsSync(join(cwd, ".xdd", "runs"));
	if (xddExists) {
		state.planIndex = 1; // jump to understand
	}
	activateXddExtension(state);
	state.stopRequested = false; // clear stale flag from previous run
	writeCheckpoint(state, "running", 0);
	const n = state.skills.length;
	const stageName = state.currentStageName();
	const skipMsg = xddExists ? "检测到 .xdd/ 已存在，跳过 init，" : "";
	const scaffoldMsg = scaffold.created.length > 0
		? `Controller 已 scaffold ${scaffold.created.length} 个目录（${scaffold.created.join(", ")}）。`
		: `Controller scaffold：所有目录已存在（${scaffold.skipped.length} 项），无新创建。`;
	await pi.sendUserMessage(
		`${task}\n\n[xdd] run ${runId} 启动。${skipMsg}${scaffoldMsg}加载了 ${n} 个 xdd 技能。当前阶段: ${stageName}。用 xdd_list_skills 查看，xdd_load_skill 加载，xdd_submit_artifact 提交产物。随时按 Esc 或 /xdd-stop 中断（可 /xdd-resume 恢复）。`,
	);
}

/** /xdd continue -- approve a pending group gate, advance to the next group. */
export async function continueXdd(_args: string, _cwd: string, pi: ExtensionAPI): Promise<void> {
	let state: XddRunnerState;
	try {
		state = getState();
	} catch {
		await pi.sendUserMessage("[xdd] 无活跃 xdd run。先用 /xdd <任务> 启动。");
		return;
	}
	if (!state.pendingGroupApproval) {
		await pi.sendUserMessage("[xdd] 当前无待确认的组级 Gate。");
		return;
	}
	const approved = state.pendingGroupApproval;
	state.pendingGroupApproval = undefined;
	state.advanceOutcome = { passed: true };
	state.clearSignals();
	const next = state.advancePlan();
	writeCheckpoint(state, "running", 0);
	if (!next) {
		state.runComplete = true;
		await pi.sendUserMessage(`[xdd] ${approved.gateLabel} 人工确认通过。全部阶段完成。`);
		return;
	}
	await pi.sendUserMessage(`[xdd] ${approved.gateLabel} 人工确认通过，进入 ${next.name}。继续。`);
}

/** /xdd resume -- restore from checkpoint OR continue a paused run.
 *
 * Phase 0 P23: atomic resume. Two paths:
 *   1. Same-session pause: stateRef still in memory, paused=true.
 *      -> waitForIdle, bump continuationEpoch, clear continuationQueued,
 *         clear paused/stopRequested/pauseNotified, status=running,
 *         send exactly ONE resume kickoff.
 *   2. Cross-process recovery: stateRef is null, read checkpoint.json
 *      and rebuild XddRunnerState (legacy path).
 * In both paths the continuationEpoch bump invalidates any followUp queued
 * before the resume (Phase 0 P22).
 */
export async function resumeXdd(_args: string, cwd: string, pi: ExtensionAPI): Promise<void> {
	// Try same-session first (stateRef still alive).
	let state: XddRunnerState | undefined;
	try {
		state = getState();
	} catch { /* no in-memory state -- fall through to checkpoint path */ }

	if (state) {
		if (!state.paused) {
			await pi.sendUserMessage("[xdd] 当前 run 未暂停，无需恢复。");
			return;
		}
		// Atomic state flip. Order matters:
		//  1. bump epoch first -> any in-flight followUp becomes stale
		//  2. clear continuationQueued -> scheduler can re-queue
		//  3. clear paused/stopRequested/pauseNotified -> auto-continue resumes
		//  4. status=running -> reflects current state
		// All four are persisted to runtime.json by the individual setters,
		// so even a crash mid-resume leaves a recoverable state.
		state.continuationEpoch = state.continuationEpoch + 1;
		state.continuationQueued = false;
		state.paused = false;
		state.stopRequested = false;
		state.pauseNotified = false;
		state.status = "running";
		const stageName = state.currentStageName() ?? "?";
		await pi.sendUserMessage(`[xdd] run ${state.runId} 已恢复。当前阶段: ${stageName}。继续。`);
		return;
	}

	// Cross-process recovery: rebuild from checkpoint.
	const cp = readCheckpoint(cwd);
	if (!cp) {
		await pi.sendUserMessage("[xdd] 无 checkpoint 可恢复。");
		return;
	}
	const newState = new XddRunnerState({ runId: cp.runId, cwd, userInput: cp.userInput });
	newState.skills = loadXddSkills(cwd);
	newState.plan = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	newState.restoreFromCheckpoint(cp);
	// Bump epoch + clear pause flags on the rebuilt state too.
	newState.continuationEpoch = (cp.continuationEpoch ?? 0) + 1;
	newState.continuationQueued = false;
	newState.paused = false;
	newState.stopRequested = false;
	newState.pauseNotified = false;
	newState.status = "running";
	activateXddExtension(newState);
	const stageName = newState.currentStageName() ?? "?";
	await pi.sendUserMessage(`[xdd] 从 checkpoint 恢复 run ${cp.runId}（epoch=${newState.continuationEpoch}），当前阶段: ${stageName}。继续。`);
}

/** /xdd status -- show current pipeline state. */
export async function xddStatus(_args: string, _cwd: string, pi: ExtensionAPI): Promise<void> {
	let state: XddRunnerState;
	try {
		state = getState();
	} catch {
		await pi.sendUserMessage("[xdd] 无活跃 xdd run。");
		return;
	}
	const stage = state.currentStage();
	const idx = state.currentIndex() + 1;
	const total = state.plan.length;
	const pending = state.pendingGroupApproval;
	if (pending) {
		await pi.sendUserMessage(
			`[xdd] 阶段 ${stage?.name} (${idx}/${total}) | ⏸ ${pending.gateLabel} 待确认: 输入 /xdd continue 推进，或检查产物后 /xdd rollback`,
		);
		return;
	}
	await pi.sendUserMessage(
		`[xdd] 阶段 ${stage?.name} (${idx}/${total}) | skills: ${state.skills.length} | ledger: ${state.ledger.length} 条`,
	);
}

/** /xdd-archive -- manually archive a completed run (summarize runs/<iter>/ + delete it). */
export async function archiveXdd(args: string, cwd: string, pi: ExtensionAPI): Promise<void> {
	const iterLabel = args.trim() || undefined; // undefined = pick most recent runs/*/
	try {
		const result = archiveRun(cwd, iterLabel);
		await pi.sendUserMessage(
			`[xdd 归档] 写入 ${result.archivePath}\n删 runs/(${result.deletedPaths.length} 文件)，读 design/ 不改 (${result.keptPaths.length} 项)`,
		);
	} catch (e) {
		await pi.sendUserMessage(`[xdd 归档失败] ${e instanceof Error ? e.message : String(e)}`);
	}
}

/**
 * /xdd-commit -- commit current (or specified) stage summary to pi session tree via navigateTree.
 *
 * NOTE: navigateTree is on ExtensionCommandContext (slash-command ctx), NOT on
 * ExtensionAPI.pi directly. Tools can\'t call it. Slash commands can. This is
 * the strongest mechanism pi exposes for extensions to navigate/commit tree.
 *
 * The actual summary text is injected by the extension\'s session_before_tree
 * hook (it has access to stateRef + buildStageSummary).
 */
export async function xddCommit(stageArg: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	let leafId: string | null;
	try {
		leafId = ctx.sessionManager.getLeafId();
	} catch {
		await pi.sendUserMessage("[xdd-commit] 无活跃 session。");
		return;
	}
	if (!leafId) {
		await pi.sendUserMessage("[xdd-commit] session 还没有任何 entry，无法 commit。");
		return;
	}
	const stageName = stageArg.trim() || "current";
	await ctx.waitForIdle();
	const result = await ctx.navigateTree(leafId, {
		summarize: true,
		label: `xdd ${stageName}`,
	});
	if (result.cancelled) {
		await pi.sendUserMessage("[xdd-commit] 已取消。");
		return;
	}
	await pi.sendUserMessage(`[xdd-commit] 已 commit 摘要到 session tree（leaf=${leafId.slice(0, 8)}...，label="xdd ${stageName}"）。输入 /tree 查看。`);
}

