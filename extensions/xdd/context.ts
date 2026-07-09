import { readFileSync } from "node:fs";
import type { Skill } from "../core/skills.ts";
import { REFLECT_PREAMBLE, XDD_PREAMBLE } from "./preambles.ts";
import type { XddRunnerState, XddStageSpec } from "./types.ts";

function readSkillContent(skills: Skill[], skillName: string): string | undefined {
	const skill = skills.find((s) => s.name === skillName);
	if (!skill) return undefined;
	try {
		return readFileSync(skill.filePath, "utf8");
	} catch {
		return undefined;
	}
}

export interface BuildStagePromptArgs {
	cwd: string;
	stage: XddStageSpec;
	userInput: string;
	skills: Skill[];
}

/**
 * Assemble the fresh per-stage system prompt. Sections (declared in order):
 *  preamble (reconcile-style abstractions) / stage role / abstract action set /
 *  current stage / user goal / cwd / desired state (declarative spec) /
 *  stage skill body / allowed tools (concrete tool names) / completion gate.
 */
export function buildStageSystemPrompt(args: BuildStagePromptArgs): string {
	const { cwd, stage, userInput, skills } = args;
	const skillBody = readSkillContent(skills, stage.skill);
	const sections: string[] = [];
	sections.push(XDD_PREAMBLE);
	sections.push(`[阶段角色] ${stage.role}——仅按本角色视角行事`);
	sections.push(
		`[抽象动作] 本阶段使用的抽象类别：${[...new Set(stage.allowedTools.map(mapToolToAbstraction))].join(
			" / ",
		)}——按抽象类别思考，工具名只是底层工具`,
	);
	sections.push(`[当前阶段] ${stage.name}（第 ${stageIndexOneBased(stage)} / 10 阶段）`);
	sections.push(`[用户原始需求] ${userInput}`);
	sections.push(`[工作目录] ${cwd}`);
	sections.push(
		`[期望状态 · desiredState] 本阶段需让以下观察型条件全部为真——完成后请调 xdd_goal_complete / xdd_verdict 触发 gate：\n${stage.desiredState
			.map((d, i) => `  ${i + 1}. ${d}`)
			.join("\n")}`,
	);
	if (skillBody) {
		sections.push(`[阶段技能 ${stage.skill}]\n${skillBody}`);
	} else {
		sections.push(`[阶段技能 ${stage.skill}] （未找到 SKILL.md，按阶段名通用指引与 desiredState 执行）`);
	}
	sections.push(`[允许工具] ${[...stage.allowedTools, ...STAGE_ORCHESTRATION_TOOLS].join(", ")}`);
	const gateTool = stage.exit === "verdict" ? "xdd_verdict" : "xdd_goal_complete";
	sections.push(
		`[完成方式 / reconcile] 让所有 desiredState 为真 → 调 ${gateTool}(summary=${
			stage.exit === "verdict" ? "{pass, summary}" : "summary"
		}) → gate 通过后调 xdd_advance 推进。闸门失败可重试，预算见状态；预算耗尽后请调 xdd_diagnose 进入反思。`,
	);
	return sections.join("\n\n");
}

export function buildReflectSystemPrompt(args: { userInput: string; cwd: string }): string {
	return [REFLECT_PREAMBLE, `[工作目录] ${args.cwd}`, `[用户目标] ${args.userInput}`].join("\n\n");
}

function stageIndexOneBased(_stage: XddStageSpec): number {
	// Best-effort ordinal. Source of truth is `state.planIndex`; the runner emits
	// the precise index in xdd_stage_start events. Without the live plan we can
	// only guess; report 0 and let the prompt label stage by name.
	return 0;
}

export { stageIndexOneBased };

/** Seed user prompt that launches a stage turn. */
export function buildSeed(stage: XddStageSpec, userInput: string): string {
	const desired = stage.desiredState.map((d, i) => `  ${i + 1}. ${d}`).join("\n");
	const gateTool = stage.exit === "verdict" ? "xdd_verdict" : "xdd_goal_complete";
	const lines = [
		`进入 xdd 阶段：${stage.name}。`,
		`本阶段角色：${stage.role}。`,
		`按稳定抽象思考：本阶段只使用抽象动作 ${[...new Set(stage.allowedTools.map(mapToolToAbstraction))].join(
			" / ",
		)}；底层工具名由 allowedTools 控制。`,
		"如需前序阶段产物，先 read 相关文件。",
		`用户原始需求：${userInput}`,
		`本阶段 desiredState（让这些条件为真）：\n${desired}`,
		`完成方式：调 ${gateTool}${stage.exit === "verdict" ? "（pass, summary）" : "（summary）"} → gate 通过 → 调 xdd_advance 推进。闸门未达标可重试（局部修复），自愈预算耗尽后再调 xdd_diagnose 进入反思。`,
	];
	return lines.join("\n");
}

/** Seed user prompt for the reflection turn after a failed verify/stage. */
export function buildReflectSeed(failedStage: XddStageSpec, reason: string): string {
	return [
		`阶段 ${failedStage.name} 未通过。失败原因：${reason}`,
		"请反思根因：可先调用 xdd_diagnose(layer, reason) 上报结构化根因（可选）。",
		"随后调用 xdd_rollback(targetStage, reason) 回退到合适的早期阶段重做；targetStage 必须早于失败阶段。",
		"若不回退，本次 run 将以失败终止。",
	].join("\n");
}

export function reflectAllowedTools(): string[] {
	return [
		"read",
		"grep",
		"find",
		"ls",
		"xdd_list_skills",
		"xdd_load_skill",
		"xdd_diagnose",
		"xdd_rollback",
		"xdd_status",
	];
}

/**
 * reconcile stable abstraction: map concrete tool names to the three semantic
 * action layers model should reason in. Used in stage system prompts and seed
 * to surface abstraction without renaming underlying tool schemas.
 */
export function mapToolToAbstraction(tool: string): "Understand" | "Modify" | "Verify" | "Orchestrate" {
	if (
		tool === "read" ||
		tool === "grep" ||
		tool === "find" ||
		tool === "ls" ||
		tool === "xdd_list_skills" ||
		tool === "xdd_load_skill"
	)
		return "Understand";
	if (tool === "write" || tool === "edit") return "Modify";
	if (
		tool === "bash" ||
		tool === "xdd_goal_complete" ||
		tool === "xdd_verdict" ||
		tool === "xdd_diagnose" ||
		tool === "xdd_rollback"
	)
		return "Verify";
	return "Orchestrate";
}

/** Orchestrator tools appended to every stage's active tool set + display list. */
export const STAGE_ORCHESTRATION_TOOLS = ["xdd_advance", "xdd_status"] as const;

/** Build the prompt for the currently active stage from shared state. */
export function buildActiveStageSystemPrompt(state: XddRunnerState): string | undefined {
	const stage = state.currentStage();
	if (!stage) return undefined;
	if (state.mode === "reflect") {
		return buildReflectSystemPrompt({ userInput: state.userInput, cwd: state.cwd });
	}
	return buildStageSystemPrompt({
		cwd: state.cwd,
		stage,
		userInput: state.userInput,
		skills: state.skills,
	});
}
