import { readFileSync } from "node:fs";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { REFLECT_PREAMBLE, XDD_PREAMBLE } from "./preambles.ts";
import type { XddRunnerState, XddStageName, XddStageSpec } from "./types.ts";
import { HarnessStore } from "./harness/store.ts";
import { conciseHarness } from "./harness/schema.ts";
import { buildPreventionContext } from "./prevention-context.ts";

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
	planIndex: number;
	planTotal: number;
}

export const NO_CODE_STAGES = new Set<XddStageName>([
	"init", "understand", "spec",
	"architecture", "wire", "resilience",
]);

export const NO_CODE_CONSTRAINT =
	"[约束] 此阶段不允许读取源代码文件（*.ts/*.tsx/*.js/*.jsx/*.py/*.go/*.java/*.rs 等）。" +
	"只允许按当前阶段的读取范围访问 .xdd/design/ 设计文件、文档、图片参考和配置文件（package.json, tsconfig.json 等）。" +
	"只关注设计（做成什么样 / 系统怎么设计），不关注现有实现（代码怎么写的）。" +
	"wire 阶段可写新的脚手架文件，但不应读现有源码。";

export const ANTI_AI_CONSTRAINT =
	"[去AI味] 所有文档产物必须像真人写的，不许有 AI 味。\n" +
	"禁止的 AI 痕迹：\n" +
	"  - 开头'随着...不断发展'、'在当今...背景下'\n" +
	"  - '首先/其次/再次/最后'的机械列举\n" +
	"  - '值得注意的是''综上所述''由此可见'等过渡套话\n" +
	"  - '高效/智能/全面/赋能/闭环/生态/深度融合/多维度协同'等营销词\n" +
	"  - '各有优缺点，应根据实际情况选择'这种没立场的废话\n" +
	"  - 每段结构过于整齐（长度/句式一模一样）\n" +
	"  - 结尾重复总结全文，没有新增价值\n" +
	"  - 正确但没信息量的常识补充（删了读者不会少知道任何事实）\n" +
	"必须做到：\n" +
	"  - 抽象词改具体事实：谁做了什么、什么场景、解决了什么具体问题、什么数量\n" +
	"  - 有明确判断和取舍：什么最重要、什么暂时不重要、哪种方案更好、为什么\n" +
	"  - 加真实语境：团队人数、已有系统限制、历史问题、已尝试但失败的方案、时间成本约束\n" +
	"  - 营销词换动作词：'赋能业务'->'减少人工审核'、'构建生态'->'自动分配任务'\n" +
	"  - 保留诚实的不确定性：'这部分还没最终答案''现阶段不值得提前优化'比强行完整更自然\n" +
	"  - 句式有节奏：长句接短句、重要结论单独成段、不必每节都写三点\n" +
	"判断标准：有具体细节 + 有明确取舍 + 有真实限制 + 有作者自己的判断 = 没有 AI 味。";

export function buildStageSystemPrompt(args: BuildStagePromptArgs): string {
	const { cwd, stage, userInput, skills, planIndex, planTotal } = args;
	const skillBody = readSkillContent(skills, stage.skill);
	const sections: string[] = [];
	sections.push(XDD_PREAMBLE);
	sections.push(ANTI_AI_CONSTRAINT);
	if (NO_CODE_STAGES.has(stage.name)) {
		sections.push(NO_CODE_CONSTRAINT);
	}
	sections.push(`[阶段角色] ${stage.role}--仅按本角色视角行事`);
	sections.push(
		`[抽象动作] 本阶段使用的抽象类别：${[...new Set(stage.allowedTools.map(mapToolToAbstraction))].join(
			" / ",
		)}--按抽象类别思考，工具名只是底层工具`,
	);
	sections.push(`[当前阶段] ${stage.name}（第 ${planIndex + 1} / ${planTotal} 阶段）`);
	sections.push(`[用户原始需求] ${userInput}`);
	sections.push(`[工作目录] ${cwd}`);
	const prevention = buildPreventionContext(cwd, stage.name, userInput);
	if (prevention.text) sections.push(prevention.text);
	const harness = buildHarnessPromptSection(cwd);
	if (harness) sections.push(harness);
	const outputContract = (stage.outputs ?? []).map((o, i) => `  ${i + 1}. ${o.pattern} -- ${o.description}`).join("\n");
	sections.push(
		`[期望状态 · desiredState] 本阶段需让以下观察型条件全部为真--完成后请调 xdd_submit_artifact 提交产物，触发 gate：\n${stage.desiredState
			.map((d, i) => `  ${i + 1}. ${d}`)
			.join("\n")}`,
	);
	sections.push(
		`[先声明产出，再接受检查] 本阶段 skill=${stage.skill}。你必须先产出这些文件/模式，再提交给对应 hard gate + AI Gate 检查；不要提交空产物让 AI Gate 空检查：\n${outputContract || "  （无硬文件产出；必须在 summary 中说明本阶段无文件产出的可观察依据）"}`,
	);
	if (skillBody) {
		sections.push(`[阶段技能 ${stage.skill}]\n${skillBody}`);
	} else {
		sections.push(`[阶段技能 ${stage.skill}] （未找到 SKILL.md，按阶段名通用指引与 desiredState 执行）`);
	}
	sections.push(`[允许工具] ${[...stage.allowedTools, ...STAGE_ORCHESTRATION_TOOLS].join(", ")}`);
	const gateHint = stage.exit === "verdict"
		? "xdd_submit_artifact(summary, artifacts, pass；随本次 AIGate 审查一并提交 selfAttack)"
		: "xdd_submit_artifact(summary, artifacts；AIGate 阶段每次提交都附带 selfAttack)";
	sections.push(
		`[完成方式 / reconcile] 让所有 desiredState 为真 -> 调 ${gateHint} -> gate 通过后调 xdd_advance 推进。闸门失败可重试，预算见状态；预算耗尽后请调 xdd_diagnose 进入反思。`,
	);
	return sections.join("\n\n");
}

function buildHarnessPromptSection(cwd: string): string {
	try {
		return conciseHarness(new HarnessStore(cwd).load());
	} catch {
		return "";
	}
}

export function buildReflectSystemPrompt(args: { userInput: string; cwd: string }): string {
	return [REFLECT_PREAMBLE, `[工作目录] ${args.cwd}`, `[用户目标] ${args.userInput}`].join("\n\n");
}

/** Seed user prompt that launches a stage turn. */
export function buildSeed(stage: XddStageSpec, userInput: string): string {
	const desired = stage.desiredState.map((d, i) => `  ${i + 1}. ${d}`).join("\n");
	const gateHint = stage.exit === "verdict"
		? "xdd_submit_artifact（summary, artifacts, pass；随本次 AIGate 审查一并提交 selfAttack）"
		: "xdd_submit_artifact（summary, artifacts；AIGate 阶段每次提交都附带 selfAttack）";
	const lines = [
		`进入 xdd 阶段：${stage.name}。`,
		`本阶段角色：${stage.role}。`,
		`按稳定抽象思考：本阶段只使用抽象动作 ${[...new Set(stage.allowedTools.map(mapToolToAbstraction))].join(
			" / ",
		)}；底层工具名由 allowedTools 控制。`,
		"如需前序阶段产物，先 read 相关文件。",
		`用户原始需求：${userInput}`,
		`本阶段 desiredState（让这些条件为真）：\n${desired}`,
		`本阶段先声明产出，再接受检查（skill=${stage.skill}）：\n${(stage.outputs ?? []).map((o, i) => `  ${i + 1}. ${o.pattern} -- ${o.description}`).join("\n") || "  （无硬文件产出；必须说明可观察依据）"}`,
		`完成方式：调 ${gateHint} -> gate 通过 -> 调 xdd_advance 推进。闸门未达标可重试（局部修复），自愈预算耗尽后再调 xdd_diagnose 进入反思。`,
		`Controller 工具：xdd_observe（观察状态）/ xdd_desired_state（查看目标）/ xdd_difference（计算差距）/ xdd_next_task（获取下一步指令）。`,
	];
	// P16: bash timeout hint for stages that use bash
	if (stage.allowedTools.includes("bash")) {
		lines.push(
			"bash 命令默认超时 300s。长时间操作（安装依赖/构建/全盘搜索）请显式传 timeout=N，避免卡死。禁用 find / 等全盘扫描。",
		);
	}
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
		"xdd_observe",
		"xdd_desired_state",
		"xdd_difference",
		"xdd_next_task",
		"xdd_diagnose",
		"xdd_rollback",
		"xdd_reset_budget",
	];
}

export function mapToolToAbstraction(tool: string): "Understand" | "Modify" | "Verify" | "Orchestrate" {
	if (
		tool === "read" ||
		tool === "grep" ||
		tool === "find" ||
		tool === "ls" ||
		tool === "xdd_list_skills" ||
		tool === "xdd_load_skill" ||
		tool === "xdd_observe" ||
		tool === "xdd_desired_state" ||
		tool === "xdd_difference" ||
		tool === "xdd_next_task"
	)
		return "Understand";
	if (tool === "write" || tool === "edit") return "Modify";
	if (
		tool === "bash" ||
		tool === "xdd_submit_artifact" ||
		tool === "xdd_diagnose" ||
		tool === "xdd_rollback" ||
		tool === "xdd_reset_budget"
	)
		return "Verify";
	return "Orchestrate";
}

export const STAGE_ORCHESTRATION_TOOLS = [
	"xdd_advance",
	"xdd_observe",
	"xdd_desired_state",
	"xdd_difference",
	"xdd_next_task",
] as const;

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
		planIndex: state.planIndex,
		planTotal: state.plan.length,
	});
}
