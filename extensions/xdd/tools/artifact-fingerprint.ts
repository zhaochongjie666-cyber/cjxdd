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
import { statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolveGlobs } from "../glob-resolver.ts";

export function computeArtifactFingerprint(cwd: string, artifactPaths: readonly string[]): string {
	// Expand all artifacts (literal + glob) to a sorted list of real files.
	const expanded = resolveGlobs(cwd, artifactPaths);
	expanded.sort();
	const parts: string[] = [];
	for (const rel of expanded) {
		try {
			const st = statSync(join(cwd, rel));
			const h = createHash("sha1");
			h.update(`${rel}|${st.mtimeMs}|${st.size}`);
			parts.push(h.digest("hex").slice(0, 16));
		} catch {
			parts.push(`${rel}:missing`);
		}
	}
	if (parts.length === 0) {
		// Nothing expanded (e.g. all patterns matched zero files). Use
		// the literal pattern list as a fingerprint of "intent" so the
		// agent at least sees "your submit is identical to last time"
		// instead of getting through silently.
		return `empty:${[...artifactPaths].sort().join("|")}`;
	}
	return parts.join("|");
}
