/**
 * Normal Flow 的阶段 system prompt 构建。跟 extensions/xdd/context.ts 的
 * buildActiveStageSystemPrompt 同样的用途，但不能直接复用：xdd 的 XDD_PREAMBLE
 * 和 buildStageSystemPrompt 里写死了大段 "xdd_next_task / xdd_diagnose / xdd
 * 反思机制" 相关的流程说明；NF 没有 diagnose/reflect 机制，也没有 next_task
 * 工具，硬改字符串会很脆（依赖 xdd 具体措辞不变，参见 xdd-text-bridge.ts 顶部
 * 注释里的耦合风险）。这里为 NF 写一份等价但准确的 preamble + 阶段 prompt。
 *
 * 复用 xdd 的通用、非 xdd 专属片段：NO_CODE_CONSTRAINT / ANTI_AI_CONSTRAINT /
 * NO_CODE_STAGES（这些不提具体工具名，只描述"这阶段能不能读代码/文风要求"）。
 */
import { readFileSync } from "node:fs";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { ANTI_AI_CONSTRAINT, NO_CODE_CONSTRAINT, NO_CODE_STAGES } from "../xdd/context.ts";
import { HarnessStore } from "../xdd/harness/store.ts";
import { conciseHarness } from "../xdd/harness/schema.ts";
import type { XddRunnerState, XddStageSpec } from "../xdd/types.ts";
import { NF_DISPLAY_NAME, type NfStageName } from "./types.ts";

const NF_PREAMBLE = `[Normal Flow · reconcile 范式]
你是 Normal Flow（xdd 的精简版）的执行体，正围绕"目标状态"持续调谐，不是一次性脚本 runner。

[声明式 API]
每个阶段不是步骤清单，是一个 desired state。系统会在 prompt 中给出当前阶段的 desiredState 列表；你的工作是让这些观察型条件全部为真。

[控制循环]
每阶段通过以下循环推进：
  1. nf_observe / nf_desired_state / nf_difference -- 看当前状态、目标、差距
  2. 按差距工作
  3. nf_submit_artifact -- 提交产物，触发硬 Gate（不调用 AIGate；语义质量由 verify 阶段的证据审查负责）
  4. Gate 通过后调 nf_advance 推进到下一阶段
失败时：Gate 未通过可在预算内反复修复重提；预算耗尽后，只有 verify 阶段可以跳回前序流程自愈（不传 targetStage 默认回 execute/implement；若验证证明规格或需求设计错误，可显式回 spec 或 understand；每次消耗一次流程回退预算）。其他阶段不会跨阶段回退，预算耗尽后自动软通过并记录告警。

[职责解耦]
每个阶段都会标注你的角色（Requirements Analyst / API Designer / Project Manager / Implementer / Auditor）。同一模型切换 focus；不要用另一个角色的方式做这一阶段的事。

铁律：
1. 只在当前阶段允许的工具范围内工作。
2. 阶段之间上下文不共享——前序阶段产物只通过文件传递。进入新阶段先 read 前序产出的关键文件，否则会失忆。
3. 当前阶段完成后必须调用 nf_submit_artifact；闸门校验产物是否真落盘，未达标当场拒绝。
4. 闸门通过后再调用 nf_advance 推进（本回合结束）。
5. 不要在产物未达标时强声明完成。`;

function readSkillContent(skills: Skill[], skillName: string): string | undefined {
	const skill = skills.find((s) => s.name === skillName);
	if (!skill) return undefined;
	try {
		return readFileSync(skill.filePath, "utf8");
	} catch {
		return undefined;
	}
}

function buildHarnessPromptSection(cwd: string): string {
	try {
		return conciseHarness(new HarnessStore(cwd).load());
	} catch {
		return "";
	}
}

function displayName(stage: XddStageSpec): string {
	return NF_DISPLAY_NAME[stage.name as NfStageName] ?? stage.name;
}

export interface BuildNfStagePromptArgs {
	cwd: string;
	stage: XddStageSpec;
	userInput: string;
	skills: Skill[];
	planIndex: number;
	planTotal: number;
}

export function buildNfStageSystemPrompt(args: BuildNfStagePromptArgs): string {
	const { cwd, stage, userInput, skills, planIndex, planTotal } = args;
	const skillBody = readSkillContent(skills, stage.skill);
	const sections: string[] = [];
	sections.push(NF_PREAMBLE);
	sections.push(ANTI_AI_CONSTRAINT);
	if (NO_CODE_STAGES.has(stage.name)) {
		sections.push(NO_CODE_CONSTRAINT);
	}
	sections.push(`[阶段角色] ${stage.role}——仅按本角色视角行事`);
	sections.push(`[当前阶段] ${displayName(stage)}（第 ${planIndex + 1} / ${planTotal} 阶段，Normal Flow）`);
	sections.push(`[用户原始需求] ${userInput}`);
	sections.push(`[工作目录] ${cwd}`);
	const harness = buildHarnessPromptSection(cwd);
	if (harness) sections.push(harness);
	const outputContract = (stage.outputs ?? []).map((o, i) => `  ${i + 1}. ${o.pattern} -- ${o.description}`).join("\n");
	sections.push(
		`[期望状态 · desiredState] 本阶段需让以下观察型条件全部为真——完成后请调 nf_submit_artifact 提交产物，触发 gate：\n${stage.desiredState
			.map((d, i) => `  ${i + 1}. ${d}`)
			.join("\n")}`,
	);
	sections.push(
		`[先声明产出，再接受检查] 本阶段 skill=${stage.skill}。你必须先产出这些文件/模式，再提交给硬 Gate 检查：\n${outputContract || "  （无硬文件产出；必须在 summary 中说明本阶段无文件产出的可观察依据）"}`,
	);
	if (skillBody) {
		sections.push(`[阶段技能 ${stage.skill}]\n${skillBody}`);
	} else {
		sections.push(`[阶段技能 ${stage.skill}]（未找到 SKILL.md，按阶段名通用指引与 desiredState 执行）`);
	}
	sections.push(`[允许工具] ${stage.allowedTools.join(", ")}`);
	const gateHint = stage.exit === "verdict"
		? "nf_submit_artifact(summary, artifacts, pass)"
		: "nf_submit_artifact(summary, artifacts)";
	sections.push(`[完成方式 / reconcile] 让所有 desiredState 为真 -> 调 ${gateHint} -> gate 通过后调 nf_advance 推进。闸门失败可在预算内重试。`);
	return sections.join("\n\n");
}

/** Build the prompt for the currently active NF stage from shared state. */
export function buildActiveNfStageSystemPrompt(state: XddRunnerState): string | undefined {
	const stage = state.currentStage();
	if (!stage) return undefined;
	return buildNfStageSystemPrompt({
		cwd: state.cwd,
		stage,
		userInput: state.userInput,
		skills: state.skills,
		planIndex: state.planIndex,
		planTotal: state.plan.length,
	});
}
