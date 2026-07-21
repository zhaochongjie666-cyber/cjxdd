import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { resolveGlobs } from "../glob-resolver.ts";

export function computeScopeDigest(cwd: string, scopes: readonly string[]): string {
	return computeDigest(cwd, scopes, false);
}

export function computeCanonicalScopeDigest(cwd: string, scopes: readonly string[]): string {
	return computeDigest(cwd, scopes, true);
}

function computeDigest(cwd: string, scopes: readonly string[], canonical: boolean): string {
	let root: string;
	try { root = realpathSync(cwd); } catch { root = resolve(cwd); }
	const hash = createHash("sha256");
	const normalizedScopes = scopes.map((scope) => scope.endsWith("/**") ? `${scope}/*` : scope);
	const files = [...new Set(resolveGlobs(cwd, normalizedScopes))].sort();
	if (files.length === 0) hash.update("<empty>");
	for (const path of files) {
		const absolute = join(cwd, path);
		const stat = lstatSync(absolute);
		hash.update(path).update("\0");
		if (stat.isSymbolicLink()) {
			const target = realpathSync(absolute);
			if (relative(root, target).startsWith("..")) throw new Error(`scope symlink escapes project: ${path}`);
			hash.update(`link:${relative(root, target)}`);
		} else if (stat.isFile()) {
			if (canonical && /\.(?:md|txt|json)$/i.test(path)) hash.update(canonicalText(absolute));
			else hashFile(hash, absolute);
		}
		hash.update("\0");
	}
	return `sha256:${hash.digest("hex")}`;
}

function canonicalText(path: string): string {
	let text = readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
	if (path.endsWith(".json")) { try { text = JSON.stringify(sortJson(JSON.parse(text))); } catch { /* keep malformed evidence exact */ } }
	return text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, "<TIMESTAMP>").replace(/(generatedAt\s*[:=]\s*)[^\s,]+/gi, "$1<TIMESTAMP>").replace(/(final\s*@\s*)[^\s]+/gi, "$1<TIMESTAMP>").trim();
}

function sortJson(value: unknown): unknown { return Array.isArray(value) ? value.map(sortJson) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortJson(item)])) : value; }

function hashFile(hash: ReturnType<typeof createHash>, path: string): void {
	const fd = openSync(path, "r");
	const chunk = Buffer.allocUnsafe(64 * 1024);
	try { for (let size = readSync(fd, chunk, 0, chunk.length, null); size > 0; size = readSync(fd, chunk, 0, chunk.length, null)) hash.update(chunk.subarray(0, size)); }
	finally { closeSync(fd); }
}

export function captureSubjectDigests(cwd: string) {
	return {
		productionDigest: computeScopeDigest(cwd, ["src/**", "lib/**", "app/**", "server/**", "client/**", "test/**", "tests/**"]),
		designDigest: computeScopeDigest(cwd, [".xdd/design/**"]),
		planDigest: computeScopeDigest(cwd, [".xdd/runs/xdd_run/plan/**", ".xdd/runs/xdd_run/plan.md", ".xdd/runs/xdd_run/qa-plan.md"]),
		verifyEvidenceDigest: computeScopeDigest(cwd, [".xdd/runs/xdd_run/verify-report.md", ".xdd/runs/xdd_run/evidence/**"]),
	};
}
