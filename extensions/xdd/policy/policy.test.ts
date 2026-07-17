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

	it("keeps upstream anchors read-only in architecture while allowing a durable change request", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-policy-"));
		const architecture = STAGES.find((stage) => stage.name === "architecture")!;
		try {
			expect(checkStagePathAccess(cwd, architecture, ".xdd/design/intent.md", "write").ok).toBe(false);
			expect(checkStagePathAccess(cwd, architecture, ".xdd/design/design.md", "write").ok).toBe(false);
			expect(checkStagePathAccess(cwd, architecture, ".xdd/design/architecture/upstream-change-requests.md", "write").ok).toBe(true);
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

	it("declares controller-owned scaffold markers as init evidence without granting writes", () => {
		expect(init.deliverablePaths).toEqual([
			".xdd/design/README.md",
			".xdd/runs/README.md",
			".xdd/archive/README.md",
		]);
		expect(init.allowedTools).not.toContain("write");
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
