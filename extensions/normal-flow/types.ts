/**
 * Normal Flow 类型别名。NF 复用 xdd 的运行时/Controller/工具形状；这里只做
 * 命名收窄和收敛 NF 用到的 4 个 xdd 阶段名，不新增独立的状态机或 schema。
 *
 * `XddRunnerState` 是类（既是类型也是构造函数），必须用普通 re-export（不能
 * `export type`），否则消费方 `new XddRunnerState(...)` 会因为运行时绑定被
 * 类型系统擦除而编译失败。
 */
export { XddRunnerState } from "../xdd/types.ts";
export type { XddStageName, XddStageSpec } from "../xdd/types.ts";

/**
 * NF 用到的 xdd stage 名子集，按执行顺序排列。display name（design/framework/
 * scenarios/verify）只在用户面文案里出现，见 NF_DISPLAY_NAME；normal-flow-runtime.json /
 * StageContract / Controller 全程只认这里的 xdd 名，不引入新 type literal。
 */
export const NF_STAGE_NAMES = ["understand", "architecture", "spec", "verify"] as const;

export type NfStageName = (typeof NF_STAGE_NAMES)[number];

/** xdd stage 名 -> Normal Flow 用户面 display name。 */
export const NF_DISPLAY_NAME: Readonly<Record<NfStageName, string>> = {
	understand: "design",
	architecture: "framework",
	spec: "scenarios",
	verify: "verify",
};

/**
 * 判断一份 Normal Flow runtime 的 plan 是否"属于" Normal Flow（阶段名全部落在 NF 的
 * 4 阶段集合内）。用于：
 *  - flow.ts 启动/恢复前检查 cwd 是否已被 xdd run 占用；
 *  - extension.ts 的 session_start 只在 checkpoint 属于 NF 时才提示
 *    /normal-flow-resume，避免对 xdd 的 checkpoint 误报。
 */
export function planStageNamesAreNf(plan: ReadonlyArray<{ stageName: string }>): boolean {
	return plan.length === NF_STAGE_NAMES.length
		&& plan.every((entry, index) => entry.stageName === NF_STAGE_NAMES[index]);
}
