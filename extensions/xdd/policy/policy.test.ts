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
const plan = STAGES.find((stage) => stage.name === "plan")!;

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

	it("removes stage scope restrictions while blocking sensitive information", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		try {
			for (const stage of STAGES) {
				expect(stage.readScopes).toEqual(["**"]);
				expect(stage.writeScopes).toEqual(["**"]);
				expect(checkStagePathAccess(cwd, stage, "src/x.ts", "read").ok).toBe(true);
				expect(checkStagePathAccess(cwd, stage, "src/x.ts", "write").ok).toBe(true);
				expect(checkStagePathAccess(cwd, stage, ".env.production", "read").ok).toBe(false);
				expect(checkStagePathAccess(cwd, stage, "config/service-account.pem", "write").ok).toBe(false);
			}
			expect(checkStagePathAccess(cwd, plan, ".env.example", "read").ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("allows plan to read back both artifacts it is responsible for producing", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		try {
			for (const path of [".xdd/runs/xdd_run/qa-plan.md", ".xdd/runs/xdd_run/plan.md"]) {
				expect(checkStagePathAccess(cwd, plan, path, "read").ok).toBe(true);
				const state = { cwd, currentStage: () => plan } as any;
				expect(() => enforceToolCallPolicy(state, { toolName: "read", input: { path } })).not.toThrow();
			}
			expect(checkStagePathAccess(cwd, plan, ".xdd/runs/xdd_run/verify-report.md", "read").ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("gives verify unrestricted scopes and its reporting tools", () => {
		expect(verify.allowedTools).toEqual(expect.arrayContaining(["write", "edit"]));
		expect(verify.allowedTools).toEqual(expect.arrayContaining(["xdd_bug_learn", "xdd_quality_score"]));
		expect(verify.writeScopes).toEqual(["**"]);
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
				expect(checkStagePathAccess(cwd, stage, "src/app.ts", "write").ok).toBe(true);
			}
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("allows understand to read both documentation and source", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		const understand = STAGES.find((stage) => stage.name === "understand")!;
		try {
			for (const path of ["context.md", "core.md", "MEMORY.md", "docs/guide.md"]) {
				expect(checkStagePathAccess(cwd, understand, path, "read").ok).toBe(true);
			}
			expect(checkStagePathAccess(cwd, understand, "src/app.ts", "read").ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("allows init to read product documents, images, and source", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		try {
			for (const path of ["prd.md", "product/brief.pdf", "assets/login-flow.png", "docs/logo.svg"]) {
				expect(checkStagePathAccess(cwd, init, path, "read").ok).toBe(true);
			}
			expect(checkStagePathAccess(cwd, init, "src/app.ts", "read").ok).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("requires an init research handoff instead of treating scaffold markers as completion", () => {
		expect(init.deliverablePaths).toEqual([".xdd/runs/xdd_run/init.md"]);
		expect(init.allowedTools).toContain("write");
	});

	it("allows spec source reads by contract", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		try {
			expect(checkStagePathAccess(cwd, spec, "src/app.ts", "read").ok).toBe(true);
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

	it("validates snake_case write paths and fails closed when a write target is absent", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		const state = { cwd, currentStage: () => plan } as any;
		try {
			expect(() => enforceToolCallPolicy(state, { toolName: "edit", input: { file_path: ".env.local" } })).toThrow("敏感信息");
			expect(() => enforceToolCallPolicy(state, { toolName: "edit", input: { replacement: "x" } })).toThrow("缺少可校验的目标路径");
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
		expect(applyBashPolicy({ command: "echo output >> /var/log/example.log" })).toBeNull();
		expect(applyBashPolicy({ command: "ls /workspace/project/README.md 2>/dev/null || echo missing" })).toBeNull();
		expect(applyBashPolicy({ command: "cat .env.production" })?.reason).toContain("敏感环境文件");
		expect(applyBashPolicy({ command: "cp config/service.pem /tmp/service.pem" })?.reason).toContain("私钥文件");
		expect(applyBashPolicy({ command: "cat .env.example" })).toBeNull();
	});

	it("allows workspace bash writes after scope restrictions are removed", () => {
		expect(applyStageBashPolicy(verify, { command: "npm test" })).toBeNull();
		expect(applyStageBashPolicy(verify, { command: "printf x > output" })).toBeNull();
		expect(applyStageBashPolicy(verify, { command: "printf x > src/x.ts" })).toBeNull();
		expect(applyStageBashPolicy(verify, { command: "echo x | tee .xdd/design/intent.md" })).toBeNull();
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
