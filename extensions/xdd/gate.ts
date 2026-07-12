import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, type Stats, statSync } from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { XddGateResult } from "./types.ts";

const execFileAsync = promisify(execFile);

/** A soft pass: nothing hard was verified, but the stage may proceed. */
export function softPass(): XddGateResult {
	return { ok: true, soft: true };
}

export function hasGlobMeta(pattern: string): boolean {
	return /[*?]/.test(pattern);
}

/** Convert a glob pattern (with * and ?) into a RegExp. Anchored to segment semantics for `/`. */
export function globToRegExp(pattern: string): RegExp {
	const segments = pattern.split("/");
	let re = "^";
	let prevWasGlobstar = false;
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		// A full "**" segment matches zero or more complete path segments
		// (crossing directory boundaries). The separator slash before it is
		// added normally; each repetition ends with "/", so the next segment
		// must NOT add a leading slash (tracked via prevWasGlobstar).
		if (seg === "**") {
			if (i > 0) re += "/";
			re += "(?:[^/]+/)*";
			prevWasGlobstar = true;
			continue;
		}
		if (i > 0 && !prevWasGlobstar) re += "/";
		re += seg
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, "[^/]*")
			.replace(/\?/g, "[^/]");
		prevWasGlobstar = false;
	}
	return new RegExp(`${re}$`);
}

/** Recursively collect file paths under `dir` (relative to `dir`), capped for safety. */
export function walkRel(dir: string, maxFiles = 5000): string[] {
	const out: string[] = [];
	const stack: string[] = [dir];
	let count = 0;
	while (stack.length > 0 && count < maxFiles) {
		const current = stack.pop() as string;
		let entries: string[];
		try {
			entries = readdirSync(current);
		} catch {
			continue;
		}
		for (const name of entries) {
			const full = join(current, name);
			let st: Stats;
			try {
				st = statSync(full);
			} catch {
				continue;
			}
			count++;
			if (st.isDirectory()) {
				stack.push(full);
			} else {
				out.push(relative(dir, full));
			}
		}
	}
	return out;
}

/**
 * Hard gate: at least one pattern must resolve to an existing file under `cwd`.
 * Literal patterns use existsSync; glob patterns walk the tree.
 */
export async function requireGlobs(cwd: string, patterns: string[]): Promise<XddGateResult> {
	if (patterns.length === 0) {
		return { ok: false, reason: "无可校验的产物路径（deliverablePaths 为空）" };
	}
	// Collect the tree once for glob patterns.
	let walked: string[] | undefined;
	for (const pattern of patterns) {
		if (!hasGlobMeta(pattern)) {
			if (existsSync(join(cwd, pattern))) {
				return { ok: true };
			}
			continue;
		}
		if (walked === undefined) walked = walkRel(cwd);
		const reg = globToRegExp(pattern);
		if (walked.some((f) => reg.test(f.replace(/\\/g, "/")))) {
			return { ok: true };
		}
	}
	return {
		ok: false,
		reason: `未找到匹配产物 (任一即可): ${patterns.join(", ")}`,
	};
}

async function isGitRepo(cwd: string): Promise<boolean> {
	try {
		await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
		return true;
	} catch {
		return false;
	}
}

/**
 * Gate for implementation stages: passes when there is at least one tracked change.
 * - Non-git directory → soft pass (cannot verify).
 * - Git directory with no changes → fail.
 * - Git directory with changes → pass.
 */
export async function gitHasChanges(cwd: string): Promise<XddGateResult> {
	if (!(await isGitRepo(cwd))) {
		return { ok: true, soft: true };
	}
	try {
		const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
		const hasChanges = stdout.trim().length > 0;
		return hasChanges ? { ok: true } : { ok: false, reason: "git 工作区无改动，未见实现产物" };
	} catch {
		return { ok: true, soft: true };
	}
}

/**
 * Resolve a pattern (literal or glob) to the first matching file path relative
 * to `cwd`, or undefined. `walked` (precomputed tree) is reused for glob
 * patterns to avoid re-walking per pattern.
 */
function resolveFirstMatch(cwd: string, pattern: string, walked?: string[]): string | undefined {
	if (!hasGlobMeta(pattern)) {
		return existsSync(join(cwd, pattern)) ? pattern : undefined;
	}
	const tree = walked ?? walkRel(cwd);
	const reg = globToRegExp(pattern);
	return tree.find((f) => reg.test(f.replace(/\\/g, "/")));
}

/**
 * Hard gate: file must exist (via requireGlobs) AND contain at least `minMatches`
 * of the given keywords. Supports glob patterns (walks the tree, checks the
 * first match). Used for spec/architecture gates that need content validation
 * beyond mere file existence (P3 Evidence First).
 */
export async function requireGlobsWithKeywords(
	cwd: string,
	patterns: string[],
	keywords: string[],
	minMatches = 2,
): Promise<XddGateResult> {
	const base = await requireGlobs(cwd, patterns);
	if (!base.ok) return base;
	let walked: string[] | undefined;
	for (const pattern of patterns) {
		if (hasGlobMeta(pattern) && walked === undefined) walked = walkRel(cwd);
		const rel = resolveFirstMatch(cwd, pattern, walked);
		if (!rel) continue;
		const content = readFileSync(join(cwd, rel), "utf8");
		const matches = keywords.filter((k) => content.includes(k));
		if (matches.length < minMatches) {
			return {
				ok: false,
				reason: `${rel} 内容缺少关键章节（需含至少 ${minMatches} 项: ${keywords.join(", ")}；实际 ${matches.length} 项）`,
			};
		}
		return { ok: true };
	}
	return { ok: true };
}

/**
 * Hard gate: file must exist AND have at least `minSize` bytes.
 * Supports glob patterns (walks the tree, checks the first match).
 * Catches empty / placeholder artifacts.
 */
export async function requireGlobsWithMinSize(
	cwd: string,
	patterns: string[],
	minSize = 100,
): Promise<XddGateResult> {
	const base = await requireGlobs(cwd, patterns);
	if (!base.ok) return base;
	let walked: string[] | undefined;
	for (const pattern of patterns) {
		if (hasGlobMeta(pattern) && walked === undefined) walked = walkRel(cwd);
		const rel = resolveFirstMatch(cwd, pattern, walked);
		if (!rel) continue;
		const stat = statSync(join(cwd, rel));
		if (stat.size < minSize) {
			return {
				ok: false,
				reason: `${rel} 内容过短（${stat.size} 字节 < ${minSize}），可能缺少必要章节`,
			};
		}
		return { ok: true };
	}
	return { ok: true };
}
