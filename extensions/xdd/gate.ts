import { execFile } from "node:child_process";
import { existsSync, readdirSync, type Stats, statSync } from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { XddGateResult } from "./types.ts";

const execFileAsync = promisify(execFile);

/** A soft pass: nothing hard was verified, but the stage may proceed. */
export function softPass(): XddGateResult {
	return { ok: true, soft: true };
}

function hasGlobMeta(pattern: string): boolean {
	return /[*?]/.test(pattern);
}

/** Convert a glob pattern (with * and ?) into a RegExp. Anchored to segment semantics for `/`. */
function globToRegExp(pattern: string): RegExp {
	const re = pattern
		.split("/")
		.map((segment) =>
			segment
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*/g, "[^/]*")
				.replace(/\?/g, "[^/]"),
		)
		.join("/");
	return new RegExp(`^${re}$`);
}

/** Recursively collect file paths under `dir` (relative to `dir`), capped for safety. */
function walkRel(dir: string, maxFiles = 5000): string[] {
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
