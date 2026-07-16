import { execFileSync } from "node:child_process";
import { platform } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { XddHarness } from "./schema.ts";

export function probeHarnessFacts(cwd: string): Partial<XddHarness> {
	const 环境: Record<string, string> = { os: platform() };
	const node = runVersion("node", ["--version"], cwd);
	const python = runVersion("python3", ["--version"], cwd) ?? runVersion("python", ["--version"], cwd);
	if (node) 环境.node = node;
	if (python) 环境.python = python;
	const 项目: Record<string, string> = {};
	if (existsSync(join(cwd, "package.json"))) {
		项目.runtime = "node";
		if (existsSync(join(cwd, "pnpm-lock.yaml"))) 项目.packageManager = "pnpm";
		else if (existsSync(join(cwd, "yarn.lock"))) 项目.packageManager = "yarn";
		else 项目.packageManager = "npm";
	}
	if (existsSync(join(cwd, "pyproject.toml"))) 项目.runtime = 项目.runtime ? `${项目.runtime},python` : "python";
	return { 环境, 项目 };
}

function runVersion(command: string, args: string[], cwd: string): string | undefined {
	try {
		return execFileSync(command, args, { cwd, timeout: 2000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch {
		return undefined;
	}
}
