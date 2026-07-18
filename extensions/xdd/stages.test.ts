import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES } from "./stages.ts";

describe("run-level self-attack", () => {
	it("does not make self-attack a design-stage desired-state item", () => {
		const designStages = ["understand", "spec", "architecture", "wire", "resilience"];
		for (const name of designStages) {
			const stage = STAGES.find((candidate) => candidate.name === name);
			expect(stage).toBeDefined();
			expect(stage!.desiredState.join("\n")).not.toContain("自我攻击");
		}
	});
});


describe("init gate", () => {
	it("fails on controller scaffold alone and requires a researched init handoff", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-init-gate-"));
		try {
			mkdirSync(join(cwd, ".xdd", "design"), { recursive: true });
			mkdirSync(join(cwd, ".xdd", "runs", "xdd_run"), { recursive: true });
			mkdirSync(join(cwd, ".xdd", "archive"), { recursive: true });
			writeFileSync(join(cwd, ".xdd", "design", "README.md"), "# Design workspace\n");
			writeFileSync(join(cwd, ".xdd", "runs", "README.md"), "# Run workspace\n");
			writeFileSync(join(cwd, ".xdd", "archive", "README.md"), "# Archive workspace\n");

			const init = STAGES.find((stage) => stage.name === "init")!;
			await expect(init.gate({ cwd, summary: "", desiredState: init.desiredState })).resolves.toMatchObject({ ok: false });

			writeFileSync(join(cwd, ".xdd", "runs", "xdd_run", "init.md"), `# Init 调研交接\n\n## 调研来源\n已阅读用户 prompt 与 README 线索，确认 Controller 脚手架 README 只表示目录存在，不代表阶段完成。\n\n## 目标\n本次 run 目标是修复 init 阶段误把脚手架当完成产物的问题。\n\n## 边界\n只调整 xdd init gate、observe 文案与测试。\n\n## 非目标\n不改后续 understand/spec 业务产物格式。\n\n## 技能\n使用 xdd-init 负责初始化调研交接。\n\n## 下一步\n进入 understand 前读取本交接。\n`);
			await expect(init.gate({ cwd, summary: "", desiredState: init.desiredState })).resolves.toMatchObject({ ok: true });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
