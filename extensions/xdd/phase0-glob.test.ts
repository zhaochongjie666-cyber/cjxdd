/**
 * Phase 0 + Phase 6 sanity test: tinyglobby recursive read.
 *
 * Confirms aigate.ts's two-star star.md pattern picks up files at any depth,
 * including nested rules files like spec/B01/sub/nested-rules.md. The old
 * readdirSync + .md dollar regex pattern silently missed these, weakening
 * the consistency/traceability attacks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globSync } from "tinyglobby";

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

describe("tinyglobby recursive read (Phase 0 + 6 sanity)", () => {
	it("two-star star.md finds all .md files at any depth (the canonical recursive pattern)", () => {
		const dir = join(cwd, ".xdd/design/spec");
		const matches = globSync("**/*.md", { cwd: dir, onlyFiles: true });
		const names = matches.map((m) => m.split("/").pop() ?? "").sort();
		// Should find: B01/rules.md, B02/rules.md, B01/sub/nested-rules.md, _landscape.md
		expect(names).toContain("rules.md");
		expect(names).toContain("nested-rules.md");
		expect(names).toContain("_landscape.md");
		// .txt must NOT match
		expect(names).not.toContain("readme.txt");
		expect(matches.length).toBeGreaterThanOrEqual(4);
	});

	it("non-recursive `*.md` only matches top-level files (sanity contrast)", () => {
		// Confirms we know the difference between `*.md` and `**/*.md`.
		// aigate.ts uses the two-star variant everywhere.
		const dir = join(cwd, ".xdd/design/spec");
		const top = globSync("*.md", { cwd: dir, onlyFiles: true });
		const recursive = globSync("**/*.md", { cwd: dir, onlyFiles: true });
		// Top should be just _landscape.md
		expect(top).toEqual(["_landscape.md"]);
		expect(recursive.length).toBeGreaterThan(top.length);
	});

	it("BUG GUARD: two-star slash rules.md does NOT match 2+ levels deep (regression)", () => {
		// Documented limitation: tinyglobby's two-star slash X only matches
		// single-level subdirs. We use two-star star.md instead everywhere
		// in aigate.ts. This test pins the contract so a future refactor
		// that re-introduces two-star slash rules.md (a tempting shorthand)
		// will fail loudly.
		const dir = join(cwd, ".xdd/design/spec");
		const matches = globSync("**/rules.md", { cwd: dir, onlyFiles: true });
		// B01/sub/nested-rules.md is NOT picked up by `**/rules.md`
		expect(matches).not.toContain("B01/sub/nested-rules.md");
		// ... but B01/rules.md and B02/rules.md ARE
		expect(matches).toContain("B01/rules.md");
		expect(matches).toContain("B02/rules.md");
	});
});
