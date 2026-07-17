import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES } from "../stages.ts";
import { checkStagePathAccess } from "./path-policy.ts";
import { applyBashPolicy } from "./bash-policy.ts";
import { ensureVerifySnapshot, diffVerifySnapshot } from "./verify-snapshot.ts";

const verify = STAGES.find((stage) => stage.name === "verify")!;
const spec = STAGES.find((stage) => stage.name === "spec")!;

describe("xdd policy", () => {
	it("allows every stage to use the lifecycle and recovery tools named in prompts", () => {
		const promptTools = [
			"xdd_observe",
			"xdd_desired_state",
			"xdd_difference",
			"xdd_next_task",
			"xdd_submit_artifact",
			"xdd_advance",
			"xdd_diagnose",
			"xdd_rollback",
		];
		for (const stage of STAGES) {
			for (const tool of promptTools) {
				expect(stage.allowedTools).toContain(tool);
			}
		}
	});

	it("blocks cwd escapes and symlink escapes", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		const outside = mkdtempSync(join(tmpdir(), "xdd-outside-"));
		try {
			symlinkSync(outside, join(cwd, "escape"));
			expect(checkStagePathAccess(cwd, verify, "../x", "read").ok).toBe(false);
			expect(checkStagePathAccess(cwd, verify, "escape/file.txt", "read").ok).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("enforces verify write scopes", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		try {
			expect(checkStagePathAccess(cwd, verify, "src/x.ts", "write").ok).toBe(false);
			expect(checkStagePathAccess(cwd, verify, ".xdd/runs/iter-1/evidence/out.txt", "write").ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("allows understand to read Markdown context without allowing source reads", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		const understand = STAGES.find((stage) => stage.name === "understand")!;
		try {
			for (const path of ["context.md", "core.md", "MEMORY.md", "docs/guide.md"]) {
				expect(checkStagePathAccess(cwd, understand, path, "read").ok).toBe(true);
			}
			expect(checkStagePathAccess(cwd, understand, "src/app.ts", "read").ok).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("blocks spec source reads by contract", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		try {
			expect(checkStagePathAccess(cwd, spec, "src/app.ts", "read").ok).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("adds bash timeout and rejects dangerous commands", () => {
		const input: { command: string; timeout?: number } = { command: "npm test" };
		expect(applyBashPolicy(input)).toBeNull();
		expect(input.timeout).toBe(300);
		expect(applyBashPolicy({ command: "find / -name x" })?.reason).toContain("find /");
	});
});


describe("verify snapshot policy", () => {
	it("detects source changes after verify starts", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-verify-snapshot-"));
		try {
			mkdirSync(join(cwd, "src"), { recursive: true });
			writeFileSync(join(cwd, "src/app.ts"), "export const x = 1;\n");
			ensureVerifySnapshot(cwd);
			writeFileSync(join(cwd, "src/app.ts"), "export const x = 2;\n");
			expect(diffVerifySnapshot(cwd).changed).toContain("src/app.ts");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
