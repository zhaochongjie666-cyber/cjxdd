import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROMPTS = [
	"review-loop.md",
	"parallel-review.md",
	"parallel-research.md",
	"parallel-context-build.md",
	"parallel-cleanup.md",
	"parallel-handoff-plan.md",
	"gather-context-and-clarify.md",
];

describe("xdd subagent prompt workflows", () => {
	it("ships workflow prompts with frontmatter and xdd roles", () => {
		for (const prompt of PROMPTS) {
			const filePath = join(ROOT, "prompts", prompt);
			expect(existsSync(filePath), prompt).toBe(true);
			const text = readFileSync(filePath, "utf8");
			expect(text.startsWith("---\n"), prompt).toBe(true);
			expect(text).toMatch(/xdd-|subagent|review|context|plan/i);
		}
	});
});
