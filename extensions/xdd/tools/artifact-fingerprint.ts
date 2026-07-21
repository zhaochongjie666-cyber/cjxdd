/**
 * Phase 5 (E.3): artifact fingerprint based on REAL EXPANDED files.
 *
 * The previous fingerprint just called statSync on each artifact path
 * -- which silently fails for glob patterns (statSync can not operate
 * on a pattern, only on a file). Result: the fingerprint was either
 * "missing" for every glob, or generated based on a single hard-coded
 * path, so a no-change retry was undetectable.
 *
 * This helper:
 *   1. Expands each artifact via glob-resolver.resolveGlobs (real files)
 *   2. Sorts deterministically (relative path ASC)
 *   3. For each file, includes path + size + mtimeMs in the hash
 *   4. Returns a stable string fingerprint
 *
 * Extracted so unit tests can import it without pulling in pi-tui.
 */
import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { resolveGlobs } from "../glob-resolver.ts";

export function computeArtifactFingerprint(cwd: string, artifactPaths: readonly string[]): string {
	// Expand all artifacts (literal + glob) to a sorted list of real files.
	const expanded = resolveGlobs(cwd, artifactPaths);
	expanded.sort();
	const root = realpathSync(cwd);
	const aggregate = createHash("sha256");
	for (const rel of expanded) {
		try {
			const absolute = join(cwd, rel);
			const st = lstatSync(absolute);
			let digest: string;
			if (st.isSymbolicLink()) {
				const resolved = realpathSync(absolute);
				if (relative(root, resolved).startsWith("..")) throw new Error(`symlink escapes project: ${rel}`);
				digest = createHash("sha256").update(`symlink:${relative(root, resolved)}`).digest("hex");
			} else {
				digest = hashFile(absolute);
			}
			aggregate.update(rel).update("\0").update(digest).update("\0");
		} catch (error) {
			if (error instanceof Error && error.message.startsWith("symlink escapes project")) throw error;
			aggregate.update(rel).update("\0missing\0");
		}
	}
	if (expanded.length === 0) {
		// Nothing expanded (e.g. all patterns matched zero files). Use
		// the literal pattern list as a fingerprint of "intent" so the
		// agent at least sees "your submit is identical to last time"
		// instead of getting through silently.
		return `empty:${[...artifactPaths].sort().join("|")}`;
	}
	return aggregate.digest("hex");
}

function hashFile(path: string): string {
	const hash = createHash("sha256");
	const fd = openSync(path, "r");
	const buffer = Buffer.allocUnsafe(64 * 1024);
	try { for (let read = readSync(fd, buffer, 0, buffer.length, null); read > 0; read = readSync(fd, buffer, 0, buffer.length, null)) hash.update(buffer.subarray(0, read)); }
	finally { closeSync(fd); }
	return hash.digest("hex");
}

export function canonicalizeEvidence(path: string): string {
	let text = readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
	if (extname(path).toLowerCase() === ".json") {
		try { return JSON.stringify(sortJson(JSON.parse(text))); } catch { /* retain malformed text for a stable digest */ }
	}
	return text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, "<TIMESTAMP>").replace(/(generatedAt\s*[:=]\s*)[^\s,]+/gi, "$1<TIMESTAMP>").replace(/(final\s*@\s*)[^\s]+/gi, "$1<TIMESTAMP>").trim();
}

export function computeCanonicalFingerprint(cwd: string, artifactPaths: readonly string[]): string {
	const hash = createHash("sha256");
	for (const rel of resolveGlobs(cwd, artifactPaths).sort()) hash.update(rel).update("\0").update(canonicalizeEvidence(resolve(cwd, rel))).update("\0");
	return hash.digest("hex");
}

function sortJson(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortJson); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortJson(v)])); return value; }
