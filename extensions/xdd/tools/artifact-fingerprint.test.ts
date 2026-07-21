import { mkdtempSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeArtifactFingerprint, computeCanonicalFingerprint } from "./artifact-fingerprint.ts";

describe("content artifact fingerprints", () => {
	it("ignores touch but detects equal-size replacement", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-fp-"));
		writeFileSync(join(cwd, "a.txt"), "abcd");
		const before = computeArtifactFingerprint(cwd, ["a.txt"]);
		utimesSync(join(cwd, "a.txt"), new Date(), new Date());
		expect(computeArtifactFingerprint(cwd, ["a.txt"])).toBe(before);
		writeFileSync(join(cwd, "a.txt"), "wxyz");
		expect(computeArtifactFingerprint(cwd, ["a.txt"])).not.toBe(before);
	});

	it("canonical digest rejects timestamp-only evidence churn", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-canonical-"));
		writeFileSync(join(cwd, "evidence.md"), "result pass\nfinal @ 2026-07-21T01:00:00.000Z\n");
		const canonical = computeCanonicalFingerprint(cwd, ["evidence.md"]);
		writeFileSync(join(cwd, "evidence.md"), "result pass\nfinal @ 2026-07-21T02:00:00.000Z\n");
		expect(computeCanonicalFingerprint(cwd, ["evidence.md"])).toBe(canonical);
	});

	it("rejects a symlink that escapes the project", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-link-"));
		const outside = join(tmpdir(), `outside-${Date.now()}.txt`);
		writeFileSync(outside, "secret");
		symlinkSync(outside, join(cwd, "escape.txt"));
		expect(() => computeArtifactFingerprint(cwd, ["escape.txt"])).toThrow(/escapes project/);
	});
});
