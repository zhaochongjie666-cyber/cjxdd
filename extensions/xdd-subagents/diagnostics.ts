import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type StaticDiagnostics = {
	command?: string;
	status: "skipped" | "passed" | "failed";
	reason?: string;
	output?: string;
};

function hasTypeScriptFiles(files: string[]): boolean {
	return files.some((file) => /\.[cm]?tsx?$/.test(file));
}

export function collectStaticDiagnostics(cwd: string, changedFiles: string[], timeoutMs = 20000): StaticDiagnostics {
	if (!hasTypeScriptFiles(changedFiles)) return { status: "skipped", reason: "no changed TypeScript files" };
	if (!existsSync(join(cwd, "tsconfig.json"))) return { status: "skipped", reason: "tsconfig.json not found" };
	const command = "npx tsc --noEmit --pretty false";
	try {
		execFileSync("npx", ["tsc", "--noEmit", "--pretty", "false"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
		return { command, status: "passed" };
	} catch (error) {
		const err = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
		const output = [err.stdout?.toString() ?? "", err.stderr?.toString() ?? "", err.message ?? ""].join("\n").trim();
		return { command, status: "failed", output };
	}
}

export function renderStaticDiagnostics(diagnostics: StaticDiagnostics): string {
	if (diagnostics.status === "skipped") return `Static diagnostics skipped: ${diagnostics.reason ?? "not applicable"}`;
	if (diagnostics.status === "passed") return `Static diagnostics passed: ${diagnostics.command}`;
	return [`Static diagnostics failed: ${diagnostics.command}`, diagnostics.output ?? "<no output>"].join("\n");
}
