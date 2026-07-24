/** NF 自包含 prompt 构建。不依赖 xdd/context.ts。 */
import { readFileSync } from "node:fs";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { HarnessStore, conciseHarness } from "./harness.ts";
import type { NfRunnerState, NfStageSpec } from "./types.ts";
import { NF_DISPLAY_NAME, type NfStageName } from "./types.ts";

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

const NF_PREAMBLE = `[Normal Flow · reconcile 范式]
你是 Normal Flow 的执行体，正围绕"目标状态"持续调谐，不是一次性脚本 runner。

[声明式 API]
每个阶段不是步骤清单，是一个 desired state。系统会在 prompt 中给出当前阶段的 desiredState 列表；你的工作是让这些观察型条件全部为真。

[控制循环]
每阶段通过以下循环推进：
  1. nf_observe / nf_desired_state / nf_difference -- 看当前状态、目标、差距
  2. 按差距工作
  3. nf_submit_artifact -- 提交产物，触发硬 Gate
  4. Gate 通过后调 nf_advance 推进到下一阶段
失败时：Gate 未通过先按错误指向的正向动作修复。verify 默认回 scenarios 继续 TDD；框架装配错误显式回 architecture；设计错误显式回 understand 补齐。

铁律：
1. 只在当前阶段允许的工具范围内工作。
2. 阶段之间上下文不共享--前序阶段产物只通过文件传递。
3. 当前阶段完成后必须调用 nf_submit_artifact。
4. 闸门通过后再调用 nf_advance 推进。`;

function readSkillContent(skills: Skill[], skillName: string): string | undefined {
	const skill = skills.find((s) => s.name === skillName);
	if (!skill) return undefined;
	try { return readFileSync(skill.filePath, "utf8"); } catch { return undefined; }
}

function stageSkillContent(skills: Skill[], stage: NfStageSpec): string | undefined {
	const names = stage.name === "understand"
		? ["xdd-brainstorm", "xdd-spec", "xdd-architecture", "xdd-frontend", "xdd-wire", "xdd-resilience"]
		: stage.name === "architecture" ? [stage.skill, "xdd-docker-helper"] : [stage.skill];
	return names.map((n) => { const b = readSkillContent(skills, n); return b ? `## ${n}\n${b}` : ""; }).filter(Boolean).join("\n\n") || undefined;
}

export function buildNfStageSystemPrompt(args: { cwd: string; stage: NfStageSpec; userInput: string; skills: Skill[]; planIndex: number; planTotal: number }): string {
	const { cwd, stage, userInput, skills, planIndex, planTotal } = args;
	const skillBody = stageSkillContent(skills, stage);
	const sections: string[] = [NF_PREAMBLE, ANTI_AI_CONSTRAINT];
	sections.push(`[阶段角色] ${stage.role}`);
	sections.push(`[当前阶段] ${NF_DISPLAY_NAME[stage.name as NfStageName] ?? stage.name}（第 ${planIndex + 1} / ${planTotal} 阶段）`);
	sections.push(`[用户原始需求] ${userInput}`);
	sections.push(`[工作目录] ${cwd}`);
	try { const h = conciseHarness(new HarnessStore(cwd).load()); if (h) sections.push(h); } catch { /* */ }
	const outputContract = (stage.outputs ?? []).map((o, i) => `  ${i + 1}. ${o.pattern} -- ${o.description}`).join("\n");
	sections.push(`[期望状态 · desiredState]\n${stage.desiredState.map((d, i) => `  ${i + 1}. ${d}`).join("\n")}`);
	sections.push(`[先声明产出，再接受检查]\n${outputContract || "  （无硬文件产出；必须说明可观察依据）"}`);
	if (skillBody) sections.push(`[阶段技能 ${stage.skill}]\n${skillBody}`);
	sections.push(`[允许工具] ${stage.allowedTools.join(", ")}`);
	const gateHint = stage.exit === "verdict" ? "nf_submit_artifact(summary, artifacts, pass)" : "nf_submit_artifact(summary, artifacts)";
	sections.push(`[完成方式] 让所有 desiredState 为真 -> 调 ${gateHint} -> gate 通过后调 nf_advance 推进。`);
	return sections.join("\n\n");
}

export function buildActiveNfStageSystemPrompt(state: NfRunnerState): string | undefined {
	const stage = state.currentStage();
	if (!stage) return undefined;
	return buildNfStageSystemPrompt({ cwd: state.cwd, stage, userInput: state.userInput, skills: state.skills, planIndex: state.planIndex, planTotal: state.plan.length });
}
