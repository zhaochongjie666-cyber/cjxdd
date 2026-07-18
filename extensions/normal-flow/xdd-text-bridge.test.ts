import { describe, expect, it } from "vitest";
import { translateXddText } from "./xdd-text-bridge.ts";

describe("translateXddText", () => {
	it("rewrites known xdd_* tool names to their nf_* equivalents", () => {
		expect(translateXddText("请调用 xdd_advance 推进。")).toBe("请调用 nf_advance 推进。");
		expect(translateXddText("请按 lastStageError 修复后重新调用 xdd_submit_artifact。")).toContain("nf_submit_artifact");
		expect(translateXddText("请调 xdd_observe、xdd_desired_state、xdd_difference，按差距完成阶段产物。")).toBe(
			"请调 nf_observe、nf_desired_state、nf_difference，按差距完成阶段产物。",
		);
	});

	it("replaces xdd_next_task (no NF equivalent) with nf_observe/nf_difference guidance", () => {
		const resumed = translateXddText("[xdd 自动推进] 恢复 spec 阶段。请调 xdd_next_task 继续。");
		expect(resumed).not.toContain("xdd_next_task");
		expect(resumed).toContain("nf_observe / nf_difference");

		const idle = translateXddText("[xdd 自动推进] 继续 spec 当前阶段。请调用 xdd_next_task，根据 Difference 工作。");
		expect(idle).not.toContain("xdd_next_task");
		expect(idle).toContain("nf_observe / nf_difference");
	});

	it("rewrites [xdd] branding and /xdd-resume to Normal Flow equivalents", () => {
		expect(translateXddText("[xdd] run 已暂停在 spec 阶段。")).toBe("[normal-flow] run 已暂停在 spec 阶段。");
		expect(translateXddText("等待 Pi 内建重试；若 Pi 未继续，请使用 /xdd-resume。")).toContain("/normal-flow-resume");
		expect(translateXddText("[xdd] run nf-123 启动。当前阶段: understand。")).toBe("[normal-flow] run nf-123 启动。当前阶段: understand。");
	});

	it("keeps Normal Flow conflict guidance free of xdd command/tool suggestions", () => {
		const conflict = "[normal-flow] cwd 已被另一个流程 run（xdd-1）占用（阶段 init → understand）。Normal Flow 不会调用或提示 xdd 工具；请先在对应流程里结束该 run，或换一个 cwd 后再启动 Normal Flow。";
		const resume = "[normal-flow] cwd 上的 checkpoint 属于另一个流程 run（xdd-1）。Normal Flow 不会调用或提示 xdd 工具；请在对应流程中恢复该 run，或换一个 cwd 后再使用 /normal-flow-resume。";
		expect(conflict).not.toMatch(/\/xdd-[\w-]+|\bxdd_\w+/);
		expect(resume).not.toMatch(/\/xdd-[\w-]+|\bxdd_\w+/);
	});

	it("leaves unrelated text untouched", () => {
		const text = "spec 阶段的 rules.md 缺少关键词。";
		expect(translateXddText(text)).toBe(text);
	});
});
