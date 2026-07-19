import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES } from "../stages.ts";
import { checkStagePathAccess } from "./path-policy.ts";
import { applyBashPolicy, applyStageBashPolicy } from "./bash-policy.ts";
import { enforceToolCallPolicy } from "./tool-policy.ts";
import { ensureVerifySnapshot, diffVerifySnapshot } from "./verify-snapshot.ts";

const verify = STAGES.find((stage) => stage.name === "verify")!;
const spec = STAGES.find((stage) => stage.name === "spec")!;
const init = STAGES.find((stage) => stage.name === "init")!;

describe("xdd policy", () => {
	it("enforces allowedTools for both xdd and Normal Flow controller namespaces", () => {
		const state = { cwd: "/tmp/xdd-policy", currentStage: () => ({ ...verify, allowedTools: ["xdd_observe", "nf_observe"] }) } as any;
		expect(() => enforceToolCallPolicy(state, { toolName: "xdd_observe" })).not.toThrow();
		expect(() => enforceToolCallPolicy(state, { toolName: "nf_observe" })).not.toThrow();
		expect(() => enforceToolCallPolicy(state, { toolName: "xdd_advance" })).toThrow("不允许工具");
		expect(() => enforceToolCallPolicy(state, { toolName: "nf_advance" })).toThrow("不允许工具");
	});

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
			expect(checkStagePathAccess(cwd, verify, ".xdd/runs/xdd_run/evidence/out.txt", "write").ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("gives verify a report writer without granting source write access", () => {
		expect(verify.allowedTools).toEqual(expect.arrayContaining(["write", "edit"]));
		expect(verify.allowedTools).toEqual(expect.arrayContaining(["xdd_bug_learn", "xdd_quality_score"]));
		expect(verify.writeScopes).toEqual(expect.arrayContaining([".xdd/knowledge/**", ".xdd/runs/xdd_run/quality-score.json"]));
		expect(verify.noCodeModification).toBe(true);
	});

	it("allows all design stages to iteratively update design artifacts", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		try {
			for (const stageName of ["understand", "spec", "architecture", "wire", "resilience"] as const) {
				const stage = STAGES.find((candidate) => candidate.name === stageName)!;
				expect(checkStagePathAccess(cwd, stage, ".xdd/design/personas/P3-项目主管.md", "write").ok).toBe(true);
				expect(checkStagePathAccess(cwd, stage, ".xdd/design/intent.md", "write").ok).toBe(true);
				expect(checkStagePathAccess(cwd, stage, ".xdd/design/architecture/overview.md", "write").ok).toBe(true);
				expect(checkStagePathAccess(cwd, stage, ".xdd/design/personas/P3-项目主管.md", "read").ok).toBe(true);
				expect(checkStagePathAccess(cwd, stage, "src/app.ts", "write").ok).toBe(false);
			}
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

	it("allows init to read product documents and image references without source reads", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		try {
			for (const path of ["prd.md", "product/brief.pdf", "assets/login-flow.png", "docs/logo.svg"]) {
				expect(checkStagePathAccess(cwd, init, path, "read").ok).toBe(true);
			}
			expect(checkStagePathAccess(cwd, init, "src/app.ts", "read").ok).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("requires an init research handoff instead of treating scaffold markers as completion", () => {
		expect(init.deliverablePaths).toEqual([".xdd/runs/xdd_run/init.md"]);
		expect(init.allowedTools).toContain("write");
	});

	it("blocks spec source reads by contract", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		try {
			expect(checkStagePathAccess(cwd, spec, "src/app.ts", "read").ok).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("allows spec edit calls to update personas and other design artifacts", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		try {
			expect(checkStagePathAccess(cwd, spec, ".xdd/design/personas/P3-项目主管.md", "write").ok).toBe(true);
			const state = { cwd, currentStage: () => spec } as any;
			expect(() => enforceToolCallPolicy(state, { toolName: "edit", input: { path: ".xdd/design/personas/P3-项目主管.md" } })).not.toThrow();
			expect(() => enforceToolCallPolicy(state, { toolName: "edit", input: { path: ".xdd/design/intent.md" } })).not.toThrow();
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("adds bash timeout and rejects dangerous commands", () => {
		const input: { command: string; timeout?: number } = { command: "npm test" };
		expect(applyBashPolicy(input)).toBeNull();
		expect(input.timeout).toBe(300);
		expect(applyBashPolicy({ command: "find / -name x" })?.reason).toContain("find /");
		expect(applyBashPolicy({ command: "rm -rf /*" })?.reason).toContain("rm -rf /");
		expect(applyBashPolicy({ command: "echo secret >> /etc/profile" })?.reason).toContain("重定向");
	});

	it("does not let bash bypass scoped-stage write policy", () => {
		expect(applyStageBashPolicy(verify, { command: "npm test" })).toBeNull();
		expect(applyStageBashPolicy(verify, { command: "printf x > output" })?.reason).toContain("verify 阶段禁止");
		expect(applyStageBashPolicy(verify, { command: "printf x > src/x.ts" })?.reason).toContain("verify 阶段禁止");
		expect(applyStageBashPolicy(verify, { command: "echo x | tee .xdd/design/intent.md" })?.reason).toContain("verify 阶段禁止");

		const state = { cwd: "/tmp/xdd-policy", currentStage: () => verify } as any;
		expect(() => enforceToolCallPolicy(state, { toolName: "bash", input: { command: "printf x > src/x.ts" } })).toThrow("verify 阶段禁止");
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
