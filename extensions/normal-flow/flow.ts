/**
 * Normal Flow 的 /normal-flow、/normal-flow-resume 命令。跟
 * extensions/xdd/run.ts 的 runXdd/resumeXdd 同样的思路（Controller START/RESUME
 * + 加载技能 + activate extension + 把任务发给模型），但只用 NF 自己的 5 阶段
 * stages 数组，且不 import/不修改 xdd 的 run.ts——避免任何一侧的隐式 STAGES
 * 依赖漏到另一侧（Docs/normal-flow.md §3 的"显式前提"）。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { NF_STAGES } from "./stages.ts";
import { NF_STAGE_NAMES, planStageNamesAreNf, XddRunnerState } from "./types.ts";
import { activateNormalFlowExtension, getState } from "./extension.ts";
import { loadXddSkills } from "../xdd/skill-loader.ts";
import { controllerInitScaffold } from "../xdd/init-scaffold.ts";
import { XddController } from "../xdd/core/controller.ts";
import { RuntimeStore } from "../xdd/storage/runtime-store.ts";
import { configuredFlowBudgetUsd } from "../xdd/flow-budget.ts";
import { dispatchNfCommand } from "./adapter.ts";

/**
 * NF 自愈预算，比 xdd 的默认值（5）更紧凑（Docs/normal-flow.md §9.5）。Flow
 * 回退预算沿用 xdd 的默认值 7，不需要覆盖。`StartOptions`（xdd/core/commands.ts）
 * 没有预算字段——这里照抄 runXdd() 对 flowBudgetUsd 的做法：dispatch(START) 之
 * 后直接用 XddRunnerState 的属性 setter 覆盖。
 */
const NF_MAX_SELF_HEAL_PER_STAGE = 3;

/** cwd 上已有一个非 NF（即 xdd）的未完成 run 时，返回冲突提示；否则 undefined。 */
function nfStartConflictMessage(cwd: string): string | undefined {
	const rt = new RuntimeStore(cwd).load();
	if (!rt || !rt.plan || rt.plan.length === 0 || rt.runComplete) return undefined;
	if (planStageNamesAreNf(rt.plan)) {
		return `[normal-flow] cwd 已有未完成的 Normal Flow run（${rt.runId}，当前阶段 ${rt.plan[rt.planIndex]?.stageName ?? "?"}）。请先 /normal-flow-resume 恢复或 /normal-flow-stop 中断，避免覆盖现有检查点。`;
	}
	return `[normal-flow] cwd 已被另一个流程 run（${rt.runId}）占用（阶段 ${rt.plan.map((e) => e.stageName).join(" → ")}）。Normal Flow 不会调用或提示 xdd 工具；请先在对应流程里结束该 run，或换一个 cwd 后再启动 Normal Flow。`;
}

/** /normal-flow <task> -- 启动一个新的 Normal Flow run。 */
export async function startNormalFlow(args: string, cwd: string, pi: ExtensionAPI): Promise<void> {
	const task = args.trim();
	if (!task) {
		await pi.sendUserMessage("[normal-flow] 用法: /normal-flow <任务描述>，例如 /normal-flow 给 web app 加 OAuth 登录");
		return;
	}
	const conflict = nfStartConflictMessage(cwd);
	if (conflict) {
		await pi.sendUserMessage(conflict);
		return;
	}
	const runId = `nf-${Date.now()}`;
	// NF 没有 init 阶段：用跟 xdd 一样的 Controller-owned 骨架脚本先建好 .xdd/
	// 目录，模型不需要用 bash 建目录，直接从 explore 阶段开始写 intent.md/design.md。
	const scaffold = controllerInitScaffold(cwd);
	const controller = new XddController(new RuntimeStore(cwd), NF_STAGES);
	controller.dispatch({ type: "START", task, options: { cwd, runId } });
	const state = new XddRunnerState({ runId, cwd, userInput: task });
	state.flowBudgetUsd = configuredFlowBudgetUsd();
	state.maxSelfHealPerStage = NF_MAX_SELF_HEAL_PER_STAGE;
	state.skills = loadXddSkills(cwd);
	state.plan = NF_STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	activateNormalFlowExtension(state);
	const n = state.skills.length;
	const scaffoldMsg = scaffold.created.length > 0
		? `已 scaffold ${scaffold.created.length} 个目录（${scaffold.created.join(", ")}）。`
		: "所有目录已存在，无新创建。";
	await pi.sendUserMessage(
		`${task}\n\n[normal-flow] run ${runId} 启动。${scaffoldMsg}加载了 ${n} 个技能。当前阶段: explore。用 nf_observe 查看状态，nf_submit_artifact 提交产物。随时 /normal-flow-stop 中断（可 /normal-flow-resume 恢复）。`,
	);
}

/** /normal-flow-resume -- 从同会话暂停状态或跨进程 checkpoint 恢复。 */
export async function resumeNormalFlow(args: string, cwd: string, pi: ExtensionAPI): Promise<void> {
	// 同会话优先：stateRef 还在内存里。
	let state: XddRunnerState | undefined;
	try {
		state = getState();
	} catch {
		/* 无内存态——走 checkpoint 路径 */
	}

	if (state) {
		if (!state.paused) {
			await pi.sendUserMessage("[normal-flow] 当前 run 未暂停，无需恢复。");
			return;
		}
		await dispatchNfCommand(state, { type: "RESUME" }, {
			pi,
			steeringInput: args,
			ctx: { hasPendingMessages: () => false, isIdle: () => true },
			getState: () => state,
		});
		return;
	}

	// 跨进程恢复：从 runtime.json 重建。
	const rt = new RuntimeStore(cwd).load();
	if (!rt || rt.runComplete) {
		await pi.sendUserMessage("[normal-flow] 无可恢复的 Normal Flow run。");
		return;
	}
	if (!planStageNamesAreNf(rt.plan ?? [])) {
		await pi.sendUserMessage(`[normal-flow] cwd 上的 checkpoint 属于另一个流程 run（${rt.runId}）。Normal Flow 不会调用或提示 xdd 工具；请在对应流程中恢复该 run，或换一个 cwd 后再使用 /normal-flow-resume。`);
		return;
	}
	const newState = new XddRunnerState({ runId: rt.runId, cwd, userInput: rt.userInput });
	newState.skills = loadXddSkills(cwd);
	// 强制注入 NF 自己的 5 阶段 plan，绝不落到 xdd 固定的 STAGES。
	newState.plan = NF_STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
	newState.restoreFromCheckpoint(rt);
	activateNormalFlowExtension(newState);
	if (newState.paused) {
		await dispatchNfCommand(newState, { type: "RESUME" }, {
			pi,
			steeringInput: args,
			ctx: { hasPendingMessages: () => false, isIdle: () => true },
			getState: () => newState,
		});
		return;
	}
	await dispatchNfCommand(
		newState,
		{ type: "RELEASE_CONTINUATION", reason: "checkpoint restored without paused flag" },
		{ pi, ctx: { hasPendingMessages: () => false, isIdle: () => true }, getState: () => newState },
	);
	const stageName = newState.currentStageName() ?? "?";
	await pi.sendUserMessage(`[normal-flow] 从检查点恢复运行 ${rt.runId}，当前阶段: ${stageName}。请调 nf_observe 继续。`);
}

/** 供测试/诊断使用：NF 的阶段名集合（不含 display name 映射）。 */
export const RESUMABLE_STAGE_NAMES = NF_STAGE_NAMES;
