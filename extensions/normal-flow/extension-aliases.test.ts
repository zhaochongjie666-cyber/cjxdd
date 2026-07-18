import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "extension.ts"), "utf8");

describe("Normal Flow slash command aliases", () => {
	it("registers /nf as a start shortcut that resumes when called without args", () => {
		expect(SRC).toContain('pi.registerCommand("nf"');
		expect(SRC).toContain('if (args.trim())');
		expect(SRC).toContain('await startNormalFlowCommand(args, ctx)');
		expect(SRC).toContain('await resumeNormalFlow(args, ctx.cwd, pi)');
	});

	it("registers resume and stop shortcuts for users who use nf naming", () => {
		expect(SRC).toContain('pi.registerCommand("nf-resume"');
		expect(SRC).toContain('pi.registerCommand("nf-stop"');
	});
});
