import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, type Stats, statSync } from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { XddGateResult } from "./types.ts";
import { readResults, computeOverallVerdict } from "./blind-journey.ts";

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

/** Directories to skip during walkRel. These bloat the walk without ever
 *  containing xdd artifacts -- node_modules alone can hold 20k+ files and
 *  blow the maxFiles cap before .xdd/ is reached, causing gates to falsely
 *  report 'file not found'. */
const WALK_EXCLUDE_DIRS = new Set([
	"node_modules", ".git", "dist", "build", "vendor",
	".next", "target", ".cache", ".turbo", "coverage",
]);

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
			// Skip non-source directories that would waste the maxFiles budget.
			if (WALK_EXCLUDE_DIRS.has(name)) continue;
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
 * Gate for implementation stages: passes when there is at least one tracked code change (excluding .xdd/).
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
		const codeChanges = stdout
			.trim()
			.split("\n")
			.filter(Boolean)
			.filter((line) => !line.includes(".xdd/"));
		return codeChanges.length > 0
			? { ok: true }
			: { ok: false, reason: "git 工作区无代码改动（已排除 .xdd/ 设计文档），未见实现产物" };
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
 * Hard gate: at least `minCount` occurrences of `pattern` across source files
 * (excluding .xdd/ design docs, node_modules, .git, build output). Used by the
 * execute stage to verify code carries @implements RXX traceability annotations.
 */
const SOURCE_EXCLUDE_RE = /^(?:\.xdd[/\\]|node_modules[/\\]|\.git[/\\]|dist[/\\]|build[/\\]|vendor[/\\]|\.next[/\\]|target[/\\])/;
const SOURCE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|rs|rb|php|c|cpp|cc|h|hpp|cs|kt|swift|scala|clj|ex|exs|erl|sh)$/;

export async function requirePatternInSource(
	cwd: string,
	pattern: RegExp,
	minCount = 1,
): Promise<XddGateResult> {
	const files = walkRel(cwd).filter(
		(f) => SOURCE_EXT_RE.test(f) && !SOURCE_EXCLUDE_RE.test(f.replace(/\\\\/g, "/")),
	);
	let count = 0;
	for (const rel of files) {
		try {
			const content = readFileSync(join(cwd, rel), "utf8");
			const m = content.match(pattern);
			if (m) count += m.length;
		} catch {
			/* skip unreadable */
		}
		if (count >= minCount) return { ok: true };
	}
	return {
		ok: false,
		reason: `源码中未找到足够匹配 (${pattern.source}，需 ${minCount} 处，实际 ${count} 处)`,
	};
}

/**
 * Hard gate: runs the project's test command and requires exit code 0.
 * Auto-detects: package.json -> npm test, go.mod -> go test, Makefile -> make test.
 * Soft-passes when no test command is found (no tests to run).
 * This is the REAL quality enforcement for the verify stage -- not just "report
 * exists" but "tests actually pass". CI=true is set to keep tests non-interactive.
 */
export async function requireTestsPass(cwd: string): Promise<XddGateResult> {
	let cmd: string[] | null = null;
	if (existsSync(join(cwd, "package.json"))) cmd = ["npm", "test"];
	else if (existsSync(join(cwd, "go.mod"))) cmd = ["go", "test", "./..."];
	else if (existsSync(join(cwd, "Makefile"))) cmd = ["make", "test"];
	if (!cmd) return { ok: true, soft: true };
	try {
		await execFileAsync(cmd[0], cmd.slice(1), {
			cwd,
			timeout: 180000,
			maxBuffer: 1024 * 1024,
			env: { ...process.env, CI: "true" },
		});
		return { ok: true };
	} catch (e) {
		const err = e as { code?: number; stderr?: string | Buffer; stdout?: string | Buffer };
		const stderr = (err.stderr ?? "").toString().slice(0, 800);
		return {
			ok: false,
			reason: `测试命令 ${cmd.join(" ")} 失败（退出码 ${err.code ?? "?"}）${stderr ? "\n" + stderr : ""}`,
		};
	}
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

/**
 * Blind Journey gate: checks that black-box user acceptance reports exist
 * and meet delivery criteria. Activates ONLY when role definitions exist
 * under .xdd/runs/iter-N/blind-journey/roles/ -- pure backend projects or
 * projects without deployed UI soft-pass.
 *
 * Gate rules (from Blind Journey design spec §16):
 * - Block on: any P0, any P1, any FAIL, any BLOCKED, insufficient evidence
 * - Allow with backlog: P3, P4
 * - P2 / PASS_WITH_FRICTION: warn but don't block (require human approval)
 */
export async function requireBlindJourneyReports(cwd: string): Promise<XddGateResult> {
	// Check if blind journey roles are defined (activates the gate)
	const runsDir = join(cwd, ".xdd", "runs");
	let rolesExist = false;
	try {
		const entries = readdirSync(runsDir, { withFileTypes: true });
		const iters = entries
			.filter((e) => e.isDirectory() && e.name.startsWith("iter-"))
			.sort()
			.reverse();
		for (const iter of iters) {
			const rolesDir = join(runsDir, iter.name, "blind-journey", "roles");
			if (existsSync(rolesDir)) {
				const roleFiles = readdirSync(rolesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".md"));
				if (roleFiles.length > 0) {
					rolesExist = true;
					break;
				}
			}
		}
	} catch { /* no runs dir */ }

	// No roles defined -> soft pass (backend-only or not yet deployed)
	if (!rolesExist) {
		return { ok: true, soft: true };
	}

	const results = readResults(cwd);
	if (results.length === 0) {
		return {
			ok: false,
			reason: "Blind Journey Gate: 已定义角色但无验收结果。请用 xdd_blind_journey 工具执行盲测用户验收。",
		};
	}

	// Check for blocking conditions
	const p0p1 = results.flatMap((r) =>
		(r.issues ?? [])
			.filter((i) => i.severity === "P0" || i.severity === "P1")
			.map((i) => ({ ...i, scenarioId: r.scenarioId, roleId: r.roleId })),
	);
	if (p0p1.length > 0) {
		return {
			ok: false,
			reason: `Blind Journey Gate: ${p0p1.length} 个 P0/P1 问题阻止发布:\n${p0p1.map((i) => `  - [${i.severity}] ${i.scenarioId}/${i.roleId}: ${i.actual} @ ${i.location}`).join("\n")}`,
		};
	}

	const fails = results.filter((r) => r.verdict === "FAIL");
	if (fails.length > 0) {
		return {
			ok: false,
			reason: `Blind Journey Gate: ${fails.length} 个场景 FAIL:\n${fails.map((r) => `  - ${r.roleId}/${r.scenarioId}: ${r.verdict}`).join("\n")}`,
		};
	}

	const blocked = results.filter((r) => r.verdict === "BLOCKED");
	if (blocked.length > 0) {
		return {
			ok: false,
			reason: `Blind Journey Gate: ${blocked.length} 个场景 BLOCKED（用户无法完成）:\n${blocked.map((r) => `  - ${r.roleId}/${r.scenarioId}`).join("\n")}`,
		};
	}

	const inconclusive = results.filter((r) => r.verdict === "INCONCLUSIVE");
	if (inconclusive.length > 0) {
		return {
			ok: false,
			reason: `Blind Journey Gate: ${inconclusive.length} 个场景 INCONCLUSIVE（证据不足）:\n${inconclusive.map((r) => `  - ${r.roleId}/${r.scenarioId}`).join("\n")}`,
		};
	}

	// P2 / PASS_WITH_FRICTION: warn but don't block
	const friction = results.filter((r) => r.verdict === "PASS_WITH_FRICTION");
	const p2 = results.flatMap((r) => (r.issues ?? []).filter((i) => i.severity === "P2"));
	if (friction.length > 0 || p2.length > 0) {
		return {
			ok: true,
			reason: `Blind Journey: ${friction.length} 个场景 PASS_WITH_FRICTION，${p2.length} 个 P2 问题（需产品负责人确认豁免）。`,
		};
	}

	return { ok: true };
}

/**
 * Hard gate: personas directory must exist with _index.md + at least 2 persona
 * files. Each persona file must be >= minSize bytes (deep persona, not a stub).
 * Checks that the 7-category role发散 methodology is recorded in _index.md.
 */
export async function requirePersonas(
	cwd: string,
	minPersonas = 2,
	minSize = 200,
): Promise<XddGateResult> {
	const personasDir = join(cwd, ".xdd/design/personas");
	if (!existsSync(personasDir)) {
		return { ok: false, reason: "understand Gate: 缺少 .xdd/design/personas/ 目录（用户角色模拟产出）" };
	}
	const indexOk = await requireGlobsWithMinSize(cwd, [".xdd/design/personas/_index.md"], minSize);
	if (!indexOk.ok) {
		return { ok: false, reason: "understand Gate: 缺少或过短的 .xdd/design/personas/_index.md（角色全景 + 发散方法论记录）" };
	}
	// Count persona files (PXX-*.md, excluding _index.md)
	const walked = walkRel(cwd);
	const personaFiles = walked.filter(
		(rel) => rel.startsWith(".xdd/design/personas/P") && rel.endsWith(".md"),
	);
	if (personaFiles.length < minPersonas) {
		return {
			ok: false,
			reason: `understand Gate: personas/ 下只有 ${personaFiles.length} 个角色档案（PXX-*.md），需至少 ${minPersonas} 个（用户角色要全面布全）`,
		};
	}
	// Check _index.md records the 7-category发散 methodology
	const indexContent = readFileSync(join(cwd, ".xdd/design/personas/_index.md"), "utf8");
	const categories = ["主用户", "管理用户", "间接用户", "外部系统", "审计合规", "开发运维", "边缘角色"];
	const missingCategories = categories.filter((c) => !indexContent.includes(c));
	if (missingCategories.length > 2) {
		return {
			ok: false,
			reason: `_index.md 缺少角色发散方法论记录（需考量 7 类：${categories.join("/")}，缺失 ${missingCategories.length} 类）`,
		};
	}
	return { ok: true };
}
