import { execFileSync } from "node:child_process";
import { startXddSubagentRun } from "./scheduler.ts";
import { loadXddSubagentsSettings } from "./settings.ts";
import type { XddSubagentRunRecord } from "./runtime-store.ts";
import { collectStaticDiagnostics, renderStaticDiagnostics } from "./diagnostics.ts";
import { collectLspDiagnostics, renderLspDiagnostics } from "./lsp-diagnostics.ts";

export type XddSubagentWatchdogConfig = {
	enabled?: boolean;
	model?: string;
	maxDiffBytes?: number;
};

export type WatchdogDiff = {
	changedFiles: string[];
	diff: string;
	truncated: boolean;
};

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

export function collectWatchdogDiff(cwd: string, maxDiffBytes = 60000): WatchdogDiff {
	const changedFiles = git(cwd, ["diff", "--name-only", "HEAD", "--"]).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const rawDiff = git(cwd, ["diff", "--", ...changedFiles]);
	const truncated = Buffer.byteLength(rawDiff, "utf8") > maxDiffBytes;
	const diff = truncated ? rawDiff.slice(0, maxDiffBytes) + "\n[diff truncated by xdd-subagents watchdog]\n" : rawDiff;
	return { changedFiles, diff, truncated };
}

export function buildWatchdogReviewTask(diff: WatchdogDiff, diagnosticsText = ""): string {
	return [
		"执行 xdd-subagents watchdog 攻击检查。",
		"",
		"目标：审查当前工作区 diff 是否破坏任务意图、测试、正向路径或兜底路径。只读，不要修改文件。",
		"",
		`Changed files (${diff.changedFiles.length}):`,
		...diff.changedFiles.map((file) => `- ${file}`),
		"",
		diagnosticsText ? `## Static Diagnostics\n${diagnosticsText}` : "",
		"",
		"要求输出：",
		"- blocker：必须修复的问题",
		"- fallback_gap：兜底缺口",
		"- positive_evidence：已证明的正向证据",
		"- verify_command：建议或已运行的验证命令",
		"",
		"```diff",
		diff.diff,
		"```",
	].join("\n");
}

export async function runWatchdogReview(cwd: string, options: { async?: boolean; model?: string; maxDiffBytes?: number } = {}): Promise<XddSubagentRunRecord | null> {
	const settings = loadXddSubagentsSettings(cwd);
	const watchdog = settings.watchdog ?? {};
	const diff = collectWatchdogDiff(cwd, options.maxDiffBytes ?? watchdog.maxDiffBytes ?? 60000);
	if (diff.changedFiles.length === 0) return null;
	const diagnosticsText = [
		renderStaticDiagnostics(collectStaticDiagnostics(cwd, diff.changedFiles)),
		renderLspDiagnostics(collectLspDiagnostics(cwd)),
	].join("\n\n");
	return startXddSubagentRun(cwd, {
		mode: "single",
		agent: "xdd-reviewer",
		task: buildWatchdogReviewTask(diff, diagnosticsText),
		async: options.async ?? true,
		model: options.model ?? watchdog.model,
	});
}
