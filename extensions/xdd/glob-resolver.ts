/**
 * Phase 6 (D): shared glob resolver + realpath safety + size caps.
 *
 * Centralizes three concerns previously duplicated across gate.ts and
 * aigate.ts:
 *   1. resolveGlobs(cwd, patterns) -- one glob API used by both hard Gate
 *      and AIGate. Returns RELATIVE paths (consistent with the rest of
 *      the codebase).
 *   2. safeRealpath(cwd, rel) -- resolves symlinks and rejects paths
 *      outside cwd (path-traversal guard).
 *   3. readCappedFiles(cwd, rels, opts) -- reads a list of files,
 *      applying per-file and total char caps, skipping unsafe paths.
 *
 * Extracted to a standalone module so unit tests can import it without
 * pulling in pi-tui (a transitive dep of extension.ts).
 *
 * Phase X (zero-dep refactor): the original implementation used
 * `tinyglobby` for glob expansion. tinyglobby is no longer a runtime
 * dep of this plugin -- we now do the recursion ourselves with
 * `node:fs` only. The pattern set we actually use is small (mostly
 * `**/*.md`), so a hand-rolled walker + RegExp is simpler, smaller,
 * and removes a transitive-install surface.
 */
import { existsSync, readFileSync, readdirSync, type Stats, statSync } from "node:fs";
import { realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** Per-file char cap. AIGate context is small, 8K chars (~2K tokens)
 *  per file is more than enough for a critical-section attack. */
export const DEFAULT_MAX_FILE_CHARS = 8_000;

/** Total cap across all files + contexts. Keeps the LLM prompt bounded
 *  even if the agent submits 50 small files. ~32K chars = ~8K tokens. */
export const DEFAULT_MAX_TOTAL_CHARS = 32_000;

/** Directories to skip during walkRel. These bloat the walk without ever
 *  containing xdd artifacts -- node_modules alone can hold 20k+ files and
 *  blow the maxFiles cap before .xdd/ is reached. Same set as gate.ts
 *  so resolver and hard-gate agree on what's "source". */
const WALK_EXCLUDE_DIRS = new Set([
	"node_modules", ".git", "dist", "build", "vendor",
	".next", "target", ".cache", ".turbo", "coverage",
]);

export interface ResolvedFile {
	/** Path relative to cwd, always uses forward slashes. */
	rel: string;
	/** Absolute path on disk after realpath resolution. */
	abs: string;
	/** File content (utf-8). */
	content: string;
	/** File size on disk in bytes. */
	bytes: number;
}

/** True when the pattern contains glob metacharacters.
 *  Recognizes *, ?, [, ], { -- the standard set tinyglobby/glob handle.
 *  Square-bracket classes are uncommon in xdd patterns but cheap to detect. */
export function hasGlobMeta(pattern: string): boolean {
	return /[*?[\]{}]/.test(pattern);
}

/** Convert a glob pattern into a RegExp anchored to the whole path.
 *  Supports the subset the plugin actually uses:
 *    - `**`     zero or more complete path segments
 *    - `*`      zero or more chars within a single segment
 *    - `?`      exactly one char within a single segment
 *    - everything else is taken literally
 *  Brace expansion / extglob are intentionally NOT supported -- if a
 *  future caller needs them, swap to minimatch or add support here.
 */
function globToRegExp(pattern: string): RegExp {
	const segments = pattern.split("/");
	let re = "^";
	let prevWasGlobstar = false;
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		if (seg === "**") {
			if (i > 0) re += "/";
			// `**` matches zero or more whole path segments. The trailing
			// `/` of each match is folded into the alternation so that the
			// next (non-globstar) segment doesn't re-add a leading `/`.
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

/** Recursively collect file paths under `dir` (relative to `dir`), capped
 *  for safety. Depth-first via an explicit stack to avoid blowing the
 *  recursion limit on deep node_modules. Mirrors gate.ts walkRel so both
 *  glob consumers in the plugin agree on what counts as "source". */
function walkRel(dir: string, maxFiles = 5_000): string[] {
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

/** Resolve one pattern to zero or more relative paths. For literal paths,
 *  returns the path iff it exists; for globs, walks the tree. */
export function resolveGlobs(cwd: string, patterns: readonly string[]): string[] {
	const out = new Set<string>();
	for (const pattern of patterns) {
		if (!hasGlobMeta(pattern)) {
			const abs = join(cwd, pattern);
			if (existsSync(abs) && statSync(abs).isFile()) {
				out.add(pattern);
			}
			continue;
		}
		// Glob: walk the tree once, filter via RegExp. We walk from cwd
		// (not from the pattern's directory prefix) so that anchored
		// patterns like `.xdd/**/*.md` keep their prefix semantics.
		const reg = globToRegExp(pattern);
		for (const rel of walkRel(cwd)) {
			const normalized = rel.replace(/\\/g, "/");
			if (reg.test(normalized)) {
				out.add(normalized);
			}
		}
	}
	return Array.from(out);
}

/** Resolve symlinks and reject any path that escapes cwd. Returns the
 *  absolute real path, or null if the path is unsafe / missing. */
export function safeRealpath(cwd: string, rel: string): string | null {
	const cwdReal = realpathSync(cwd);
	const targetAbs = resolve(cwdReal, rel);
	if (!existsSync(targetAbs)) return null;
	let targetReal: string;
	try {
		targetReal = realpathSync(targetAbs);
	} catch {
		return null;
	}
	// Ensure the real path is inside the real cwd. relative() returns a
	// path starting with ".." if the target is outside.
	const inside = relative(cwdReal, targetReal);
	if (inside.startsWith("..") || isAbsolute(inside)) return null;
	return targetReal;
}

function isAbsolute(p: string): boolean {
	return p.startsWith("/") || /^[A-Za-z]:/.test(p);
}

export interface ReadCappedOptions {
	/** Max chars per file (truncated with a marker). */
	maxFileChars?: number;
	/** Max total chars across all files. Once exceeded, remaining files
	 *  are dropped (with a count in the result). */
	maxTotalChars?: number;
}

export interface ReadCappedResult {
	files: ResolvedFile[];
	truncatedFiles: string[]; // relative paths truncated for length
	droppedFiles: string[]; // relative paths dropped because total cap hit
	unsafeFiles: string[]; // relative paths rejected (path traversal)
	totalChars: number;
}

/** Read a list of relative paths with caps. Unsafe paths are silently
 *  dropped (not an error -- e.g. a symlink pointing outside cwd is just
 *  not read; the agent must fix the artifact path). */
export function readCappedFiles(
	cwd: string,
	rels: readonly string[],
	opts: ReadCappedOptions = {},
): ReadCappedResult {
	const maxFile = opts.maxFileChars ?? DEFAULT_MAX_FILE_CHARS;
	const maxTotal = opts.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
	const files: ResolvedFile[] = [];
	const truncated: string[] = [];
	const dropped: string[] = [];
	const unsafe: string[] = [];
	let total = 0;
	for (const rel of rels) {
		if (total >= maxTotal) {
			dropped.push(rel);
			continue;
		}
		const real = safeRealpath(cwd, rel);
		if (!real) {
			unsafe.push(rel);
			continue;
		}
		let content: string;
		try {
			content = readFileSync(real, "utf8");
		} catch {
			unsafe.push(rel);
			continue;
		}
		const bytes = statSync(real).size;
		if (content.length > maxFile) {
			content = content.slice(0, maxFile) + "\n... (truncated)";
			truncated.push(rel);
		}
		// Stay within total cap -- truncate the last file if needed.
		const remaining = maxTotal - total;
		if (content.length > remaining) {
			content = content.slice(0, remaining) + "\n... (truncated: total cap)";
			truncated.push(rel);
		}
		total += content.length;
		files.push({ rel, abs: real, content, bytes });
	}
	return { files, truncatedFiles: truncated, droppedFiles: dropped, unsafeFiles: unsafe, totalChars: total };
}