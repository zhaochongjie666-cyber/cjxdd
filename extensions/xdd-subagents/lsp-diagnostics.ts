import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export type LspDiagnosticsResult = { kind: "lsp"; available: boolean; ok: boolean; command: string; output: string };

export function collectLspDiagnostics(cwd: string, maxBytes = 60000): LspDiagnosticsResult {
	if (!existsSync(join(cwd, "tsconfig.json"))) return { kind: "lsp", available: false, ok: true, command: "typescript-language-server --stdio", output: "未发现 tsconfig.json，跳过 LSP diagnostics。" };
	const probe = spawnSync("typescript-language-server", ["--version"], { cwd, encoding: "utf8" });
	if (probe.error) return { kind: "lsp", available: false, ok: true, command: "typescript-language-server --stdio", output: "未安装 typescript-language-server，已降级到 tsc 静态诊断。" };
	const tsc = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], { cwd, encoding: "utf8", timeout: 30000 });
	const output = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`.slice(0, maxBytes) || "LSP/TypeScript diagnostics 未返回问题。";
	return { kind: "lsp", available: true, ok: tsc.status === 0, command: "typescript-language-server --stdio + npx tsc --noEmit --pretty false", output };
}

export function renderLspDiagnostics(result: LspDiagnosticsResult): string {
	return [`## LSP Diagnostics`, `available=${result.available} ok=${result.ok}`, `command: ${result.command}`, "```", result.output, "```"].join("\n");
}
