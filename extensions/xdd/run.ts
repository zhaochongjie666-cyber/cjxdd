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
import { archiveRun } from "./archive.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** /xdd <task> -- start a new xdd run. */
export async function runXdd(args: string, cwd: string, pi: ExtensionAPI): Promise<void> {
	const task = args.trim();
	if (!task) {
		await pi.sendUserMessage("[xdd] 用法: /xdd <任务描述>，例如 /xdd 构建一个认证服务");
		return;
	}
	const runId = `xdd-${Date.now()}`;
	const state = new XddRunnerState({ runId, cwd, userInput: task });
	state.skills = loadXddSkills(cwd);
	state.plan = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	state.startRun();
	activateXddExtension(state);
	writeCheckpoint(state, "running", 0);
	const n = state.skills.length;
	await pi.sendUserMessage(
		`${task}\n\n[xdd] run ${runId} 启动。加载了 ${n} 个 xdd 技能。当前阶段: init。用 xdd_list_skills 查看，xdd_load_skill 加载，xdd_submit_artifact 提交产物。`,
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

/** /xdd resume -- restore from checkpoint after a crash/interruption. */
export async function resumeXdd(_args: string, cwd: string, pi: ExtensionAPI): Promise<void> {
	const cp = readCheckpoint(cwd);
	if (!cp) {
		await pi.sendUserMessage("[xdd] 无 checkpoint 可恢复。");
		return;
	}
	const state = new XddRunnerState({ runId: cp.runId, cwd, userInput: cp.userInput });
	state.skills = loadXddSkills(cwd);
	state.plan = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	state.restoreFromCheckpoint(cp);
	activateXddExtension(state);
	const stageName = state.currentStageName() ?? "?";
	await pi.sendUserMessage(`[xdd] 从 checkpoint 恢复 run ${cp.runId}，当前阶段: ${stageName}。继续。`);
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

