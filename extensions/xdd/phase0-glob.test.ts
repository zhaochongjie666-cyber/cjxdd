/**
 * Phase 0 + Phase 6 sanity test: recursive glob read.
 *
 * Confirms the shared glob-resolver's recursive star-dot-md pattern
 * picks up files at any depth, including nested rules files like
 * spec/B01/sub/nested-rules.md. The old readdirSync + dot-md dollar
 * regex pattern silently missed these, weakening the
 * consistency/traceability attacks in aigate.ts.
 *
 * Phase X: previously imported globSync from tinyglobby directly.
 * Now exercises the in-house resolver to keep this plugin zero-dep.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGlobs } from "./glob-resolver.ts";

let cwd = "";

beforeAll(() => {
	cwd = mkdtempSync(join(tmpdir(), "xdd-glob-"));
	// Set up a nested structure mimicking real xdd projects
	mkdirSync(join(cwd, ".xdd/design/spec/B01/sub"), { recursive: true });
	mkdirSync(join(cwd, ".xdd/design/spec/B02"), { recursive: true });
	writeFileSync(join(cwd, ".xdd/design/spec/B01/rules.md"), "B01");
	writeFileSync(join(cwd, ".xdd/design/spec/B02/rules.md"), "B02");
	writeFileSync(join(cwd, ".xdd/design/spec/_landscape.md"), "landscape");
	writeFileSync(join(cwd, ".xdd/design/spec/B01/sub/nested-rules.md"), "nested");
	writeFileSync(join(cwd, ".xdd/design/spec/B01/sub/readme.txt"), "txt ignored");
});

afterAll(() => {
	if (cwd) rmSync(cwd, { recursive: true });
});

describe("recursive glob read (Phase 0 + 6 sanity)", () => {
	it("recursive star-dot-md finds all .md files at any depth (the canonical recursive pattern)", () => {
		const matches = resolveGlobs(cwd, [".xdd/design/spec/**/*.md"]);
		const names = matches.map((m) => m.split("/").pop() ?? "").sort();
		// Should find: B01/rules.md, B02/rules.md, B01/sub/nested-rules.md, _landscape.md
		expect(names).toContain("rules.md");
		expect(names).toContain("nested-rules.md");
		expect(names).toContain("_landscape.md");
		// .txt must NOT match
		expect(names).not.toContain("readme.txt");
		expect(matches.length).toBeGreaterThanOrEqual(4);
	});

	it("non-recursive *.md only matches top-level files (sanity contrast)", () => {
		// Confirms we know the difference between single-star-dot-md
		// and recursive-star-dot-md. aigate.ts uses the recursive
		// variant everywhere.
		const top = resolveGlobs(cwd, [".xdd/design/spec/*.md"]);
		const recursive = resolveGlobs(cwd, [".xdd/design/spec/**/*.md"]);
		// Top should be just _landscape.md
		expect(top).toEqual([".xdd/design/spec/_landscape.md"]);
		expect(recursive.length).toBeGreaterThan(top.length);
	});

	it("BUG GUARD: **/rules.md does NOT match 2+ levels deep (regression)", () => {
		// Documented limitation: recursive-star/name.md is NOT the same
		// as recursive-star/sub/name.md -- the globstar only consumes
		// whole segments, and a literal name segment only matches that
		// exact segment. Concretely, with
		// .xdd/design/spec/B01/sub/nested-rules.md:
		//   recursive-star/rules.md  -> does NOT match (the segment is
		//                                "nested-rules", not "rules")
		//   recursive-star/*.md      -> DOES match
		// This test pins the contract so a future refactor that
		// re-introduces recursive-star/rules.md as a tempting shorthand
		// will fail loudly with a clarifying test failure.
		const matches = resolveGlobs(cwd, [".xdd/design/spec/**/rules.md"]);
		// (pattern kept verbatim here -- the docs above explain why
		// this is the literal form being tested.)
		// nested-rules.md is NOT picked up by `**/rules.md`
		expect(matches).not.toContain(".xdd/design/spec/B01/sub/nested-rules.md");
		// ... but B01/rules.md and B02/rules.md ARE
		expect(matches).toContain(".xdd/design/spec/B01/rules.md");
		expect(matches).toContain(".xdd/design/spec/B02/rules.md");
	});
});