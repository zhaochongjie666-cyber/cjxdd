import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createXddListSkillsTool } from "./xdd-list-skills.ts";
import { createXddLoadSkillTool } from "./xdd-load-skill.ts";

const originalCwd = process.cwd();

afterEach(() => {
	process.chdir(originalCwd);
});

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
	return result.content[0].text;
}

describe("xdd skill tools without active xdd controller", () => {
	it("lists shared skills from cwd when xdd state is inactive", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-skill-list-"));
		try {
			const skillDir = join(dir, "skills", "xdd-shared-demo");
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(join(skillDir, "SKILL.md"), "---\ndescription: shared demo\n---\n# Shared Demo\n");
			process.chdir(dir);

			const tool = createXddListSkillsTool(() => {
				throw new Error("[xdd] 无活跃 xdd run（state 未注入）");
			});
			const result = await tool.execute("", {});

			expect(textOf(result as never)).toContain("xdd-shared-demo: shared demo");
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("loads a shared skill from cwd when xdd state is inactive", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-skill-load-"));
		try {
			const skillDir = join(dir, "skills", "xdd-shared-demo");
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(join(skillDir, "SKILL.md"), "---\ndescription: shared demo\n---\n# Shared Demo\n");
			process.chdir(dir);

			const tool = createXddLoadSkillTool(() => {
				throw new Error("[xdd] 无活跃 xdd run（state 未注入）");
			});
			const result = await tool.execute("", { name: "xdd-shared-demo" });

			expect(textOf(result as never)).toContain("# Shared Demo");
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});
