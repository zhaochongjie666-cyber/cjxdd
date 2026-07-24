/**
 * NF 自包含 gate helpers。不依赖 xdd/gate.ts。
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, type Stats, statSync } from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { NfGateResult } from "./types.ts";
import { HarnessStore } from "./harness.ts";

const execFileAsync = promisify(execFile);

export function softPass(): NfGateResult { return { ok: true, soft: true }; }

export function hasGlobMeta(pattern: string): boolean { return /[*?]/.test(pattern); }

export function globToRegExp(pattern: string): RegExp {
	const segments = pattern.split("/");
	let re = "^";
	let prevWasGlobstar = false;
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		if (seg === "**") { if (i > 0) re += "/"; re += "(?:[^/]+/)*"; prevWasGlobstar = true; continue; }
		if (i > 0 && !prevWasGlobstar) re += "/";
		re += seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
		prevWasGlobstar = false;
	}
	return new RegExp(`${re}$`);
}

const WALK_EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", "build", "vendor", ".next", "target", ".cache", ".turbo", "coverage"]);

export function walkRel(dir: string, maxFiles = 5000): string[] {
	const out: string[] = [];
	const stack: string[] = [dir];
	let count = 0;
	while (stack.length > 0 && count < maxFiles) {
		const current = stack.pop() as string;
		let entries: string[];
		try { entries = readdirSync(current); } catch { continue; }
		for (const name of entries) {
			if (WALK_EXCLUDE_DIRS.has(name)) continue;
			const full = join(current, name);
			let st: Stats;
			try { st = statSync(full); } catch { continue; }
			count++;
			if (st.isDirectory()) stack.push(full);
			else out.push(relative(dir, full));
		}
	}
	return out;
}

export async function requireGlobs(cwd: string, patterns: string[]): Promise<NfGateResult> {
	if (patterns.length === 0) return { ok: false, reason: "无可校验的产物路径" };
	let walked: string[] | undefined;
	for (const pattern of patterns) {
		if (!hasGlobMeta(pattern)) { if (existsSync(join(cwd, pattern))) return { ok: true }; continue; }
		if (walked === undefined) walked = walkRel(cwd);
		const reg = globToRegExp(pattern);
		if (walked.some((f) => reg.test(f.replace(/\\/g, "/")))) return { ok: true };
	}
	return { ok: false, reason: `未找到匹配产物 (任一即可): ${patterns.join(", ")}` };
}

function resolveFirstMatch(cwd: string, pattern: string, walked?: string[]): string | undefined {
	if (!hasGlobMeta(pattern)) return existsSync(join(cwd, pattern)) ? pattern : undefined;
	const tree = walked ?? walkRel(cwd);
	const reg = globToRegExp(pattern);
	return tree.find((f) => reg.test(f.replace(/\\/g, "/")));
}

const SOURCE_EXCLUDE_RE = /^(?:\.xdd[/\\]|node_modules[/\\]|\.git[/\\]|dist[/\\]|build[/\\]|vendor[/\\]|\.next[/\\]|target[/\\])/;
const SOURCE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|rs|rb|php|c|cpp|cc|h|hpp|cs|kt|swift|scala|clj|ex|exs|erl|sh)$/;

export async function requirePatternInSource(cwd: string, pattern: RegExp, minCount = 1): Promise<NfGateResult> {
	const files = walkRel(cwd).filter((f) => SOURCE_EXT_RE.test(f) && !SOURCE_EXCLUDE_RE.test(f.replace(/\\/g, "/")));
	let count = 0;
	for (const rel of files) {
		try { const content = readFileSync(join(cwd, rel), "utf8"); const m = content.match(pattern); if (m) count += m.length; } catch { /* skip */ }
		if (count >= minCount) return { ok: true };
	}
	return { ok: false, reason: `源码中未找到足够匹配 (${pattern.source}，需 ${minCount} 处，实际 ${count} 处)` };
}

export async function requireGlobsWithKeywords(cwd: string, patterns: string[], keywords: string[], minMatches = 2): Promise<NfGateResult> {
	const base = await requireGlobs(cwd, patterns);
	if (!base.ok) return base;
	let walked: string[] | undefined;
	for (const pattern of patterns) {
		if (hasGlobMeta(pattern) && walked === undefined) walked = walkRel(cwd);
		const rel = resolveFirstMatch(cwd, pattern, walked);
		if (!rel) continue;
		const content = readFileSync(join(cwd, rel), "utf8");
		const matches = keywords.filter((k) => content.includes(k));
		if (matches.length < minMatches) return { ok: false, reason: `${rel} 内容缺少关键章节（需含至少 ${minMatches} 项: ${keywords.join(", ")}；实际 ${matches.length} 项）` };
		return { ok: true };
	}
	return { ok: true };
}

export async function requireGlobsWithMinSize(cwd: string, patterns: string[], minSize = 100): Promise<NfGateResult> {
	const base = await requireGlobs(cwd, patterns);
	if (!base.ok) return base;
	let walked: string[] | undefined;
	for (const pattern of patterns) {
		if (hasGlobMeta(pattern) && walked === undefined) walked = walkRel(cwd);
		const rel = resolveFirstMatch(cwd, pattern, walked);
		if (!rel) continue;
		const stat = statSync(join(cwd, rel));
		if (stat.size < minSize) return { ok: false, reason: `${rel} 内容过短（${stat.size} 字节 < ${minSize}），可能缺少必要章节` };
		return { ok: true };
	}
	return { ok: true };
}

async function isGitRepo(cwd: string): Promise<boolean> {
	try { await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd }); return true; } catch { return false; }
}

export async function gitHasChanges(cwd: string): Promise<NfGateResult> {
	if (!(await isGitRepo(cwd))) return { ok: true, soft: true };
	try {
		const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
		const codeChanges = stdout.trim().split("\n").filter(Boolean).filter((line) => !line.includes(".xdd/"));
		return codeChanges.length > 0 ? { ok: true } : { ok: false, reason: "git 工作区无代码改动（已排除 .xdd/），未见实现产物" };
	} catch { return { ok: true, soft: true }; }
}

export async function runBuild(cwd: string): Promise<NfGateResult> {
	let cmd: string[] | null = null;
	if (existsSync(join(cwd, "package.json"))) {
		try { const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")); if (pkg.scripts?.build) cmd = ["npm", "run", "build"]; } catch { /* */ }
	}
	if (!cmd && existsSync(join(cwd, "go.mod"))) cmd = ["go", "build", "./..."];
	if (!cmd && existsSync(join(cwd, "Makefile"))) cmd = ["make", "build"];
	if (!cmd) return { ok: true };
	try {
		await execFileAsync(cmd[0], cmd.slice(1), { cwd, timeout: 180_000, maxBuffer: 1024 * 1024, env: { ...process.env, CI: "true" } });
		return { ok: true };
	} catch (e) {
		const err = e as { code?: number; stderr?: string | Buffer };
		return { ok: false, reason: `构建命令 ${cmd.join(" ")} 失败（退出码 ${err.code ?? "?"}）${(err.stderr ?? "").toString().slice(0, 800)}` };
	}
}

export async function requireTestsPass(cwd: string): Promise<NfGateResult> {
	const store = new HarnessStore(cwd);
	const harnessCommands = store.load().验证命令;
	if (harnessCommands.length > 0) {
		const failures: string[] = [];
		for (const command of harnessCommands) {
			const result = await runExecFileCommand(cwd, command, "bash", ["-lc", command]);
			if (!result.ok) failures.push(result.reason ?? `${command} failed`);
		}
		return failures.length === 0 ? { ok: true } : { ok: false, reason: `Harness 验证命令失败：\n${failures.join("\n")}` };
	}
	let cmd: string[] | null = null;
	let discovered: string | null = null;
	if (existsSync(join(cwd, "package.json"))) { cmd = ["npm", "test"]; discovered = "npm test"; }
	else if (existsSync(join(cwd, "go.mod"))) { cmd = ["go", "test", "./..."]; discovered = "go test ./..."; }
	else if (existsSync(join(cwd, "Makefile"))) { cmd = ["make", "test"]; discovered = "make test"; }
	if (!cmd || !discovered) return { ok: false, reason: "未检测到测试命令，且 .xdd/harness.yml 未配置 验证命令。请用 nf_harness_set（如可用）或确保 package.json/Makefile 存在。" };
	const result = await runExecFileCommand(cwd, discovered, cmd[0], cmd.slice(1));
	if (result.ok) store.update("验证命令", "append", discovered);
	return result;
}

async function runExecFileCommand(cwd: string, label: string, command: string, args: string[]): Promise<NfGateResult> {
	try {
		await execFileAsync(command, args, { cwd, timeout: 180000, maxBuffer: 1024 * 1024, env: { ...process.env, CI: "true" } });
		return { ok: true };
	} catch (e) {
		const err = e as { code?: number; stderr?: string | Buffer };
		return { ok: false, reason: `测试命令 ${label} 失败（退出码 ${err.code ?? "?"}）${(err.stderr ?? "").toString().slice(0, 800)}` };
	}
}
