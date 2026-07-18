import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controllerInitScaffold } from "../init-scaffold.ts";
import { HookRunner } from "./runner.ts";

function tmpProject(): string {
	const cwd = mkdtempSync(join(tmpdir(), "xdd-hooks-"));
	controllerInitScaffold(cwd);
	return cwd;
}

function hook(cwd: string, point: string, name: string, body: string): string {
	const dir = join(cwd, ".xdd", "hooks", point);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, name);
	writeFileSync(file, body, "utf8");
	return file;
}

const payload = { hook: "before_tools" as const, runId: "r", stage: "verify" as const, stageEpoch: "r:verify:0", cwd: "/tmp/x" };

describe("HookRunner", () => {
	it("scaffolds hook directories and readme", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-hooks-scaffold-"));
		try {
			const result = controllerInitScaffold(cwd);
			expect(result.created).toContain(".xdd/hooks/before_tools");
			expect(existsSync(join(cwd, ".xdd", "hooks", "README.md"))).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("passes empty and invalid JSON hook output with warnings", async () => {
		const cwd = tmpProject();
		try {
			hook(cwd, "before_tools", "01-empty.js", "process.stdin.resume();");
			hook(cwd, "before_tools", "02-invalid.js", "process.stdin.resume(); process.stdin.on('end', () => console.log('not-json'));");
			const result = await new HookRunner(cwd).run("before_tools", payload);
			expect(result.action).toBe("pass");
			expect(result.records).toHaveLength(2);
			expect(result.warnings.join("\n")).toContain("invalid JSON");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("blocks on first block output and skips later hooks", async () => {
		const cwd = tmpProject();
		try {
			hook(cwd, "before_tools", "01-block.js", "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({action:'block', reason:'no'})));");
			hook(cwd, "before_tools", "02-pass.js", "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({action:'pass'})));");
			const result = await new HookRunner(cwd).run("before_tools", payload);
			expect(result.action).toBe("block");
			expect(result.reason).toBe("no");
			expect(result.records).toHaveLength(1);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("merges continue prompts in filename order", async () => {
		const cwd = tmpProject();
		try {
			hook(cwd, "turn_start", "02-b.js", "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({action:'continue', prompt:'b'})));");
			hook(cwd, "turn_start", "01-a.js", "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({action:'continue', prompt:'a'})));");
			const result = await new HookRunner(cwd).run("turn_start", { ...payload, hook: "turn_start" });
			expect(result.action).toBe("continue");
			expect(result.prompt).toBe("a\n\nb");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});


	it("does not execute hooks when the hooks root escapes through a symlink", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-hooks-"));
		const outside = mkdtempSync(join(tmpdir(), "xdd-hooks-outside-"));
		try {
			mkdirSync(join(cwd, ".xdd"), { recursive: true });
			mkdirSync(join(outside, "before_tools"), { recursive: true });
			writeFileSync(join(outside, "before_tools", "01-block.js"), "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({action:'block', reason:'escaped'})));");
			symlinkSync(outside, join(cwd, ".xdd", "hooks"), "dir");
			const result = await new HookRunner(cwd).run("before_tools", payload);
			expect(result.action).toBe("pass");
			expect(result.records).toHaveLength(0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("aborts running hook process groups so reload leaves no hook process", async () => {
		const cwd = tmpProject();
		try {
			const pidFile = join(cwd, "hook.pid");
			hook(cwd, "before_tools", "01-hang.cjs", `
const { writeFileSync } = require('node:fs');
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 10_000);
`);
			const controller = new AbortController();
			const run = new HookRunner(cwd, { timeoutMs: 10_000, signal: controller.signal }).run("before_tools", payload);
			await waitFor(() => existsSync(pidFile));
			const pid = Number(readFileSync(pidFile, "utf8"));
			expect(isProcessAlive(pid)).toBe(true);
			controller.abort();
			const result = await run;
			expect(result.records[0].warning).toContain("aborted");
			await waitFor(() => !isProcessAlive(pid));
			expect(isProcessAlive(pid)).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("times out and aborts hook process groups as pass warning", async () => {
		const cwd = tmpProject();
		try {
			hook(cwd, "before_tools", "01-sleep.js", "setTimeout(() => {}, 10_000);");
			const result = await new HookRunner(cwd, { timeoutMs: 50 }).run("before_tools", payload);
			expect(result.action).toBe("pass");
			expect(result.records[0].timedOut).toBe(true);
			expect(result.warnings[0]).toContain("timed out");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("waitFor timeout");
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
