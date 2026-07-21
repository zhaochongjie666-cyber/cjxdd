import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureHealingBaseline, healingSignature, verifyReceiptMatches } from "./healing-case.ts";
import { captureSubjectDigests } from "./content-digest.ts";

describe("HealingCase primitives", () => {
	it("creates stable signatures independent of file ordering and whitespace", () => {
		const a = healingSignature({ code: "TRACE_GAP", reason: "R04   missing", files: ["src/b.ts", "src/a.ts"] }, "execute");
		const b = healingSignature({ code: "TRACE_GAP", reason: "r04 missing", files: ["src/a.ts", "src/b.ts"] }, "execute");
		expect(a).toBe(b);
	});

	it("detects owner-scope changes and stale receipts", () => {
		const cwd = mkdtempSync(join(tmpdir(), "xdd-healing-"));
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(join(cwd, "src", "a.ts"), "export const a = 1;\n");
		const baseline = captureHealingBaseline(cwd, ["src/**"]);
		writeFileSync(join(cwd, "README.md"), "unrelated\n");
		expect(captureHealingBaseline(cwd, ["src/**"]).ownerScopeDigest).toBe(baseline.ownerScopeDigest);
		const subject = captureSubjectDigests(cwd);
		const receipt = { generation: 2, healingCaseId: "HC-002", capturedAt: new Date().toISOString(), ...subject, commands: [{ command: "test", exitCode: 0, outputDigest: "sha256:x" }] };
		expect(verifyReceiptMatches(cwd, receipt, 2, "HC-002").ok).toBe(true);
		expect(verifyReceiptMatches(cwd, receipt, 3, "HC-002").code).toBe("EVIDENCE_STALE_AFTER_ROLLBACK");
		writeFileSync(join(cwd, "src", "a.ts"), "export const a = 2;\n");
		expect(verifyReceiptMatches(cwd, receipt, 2, "HC-002").code).toBe("EVIDENCE_SUBJECT_MISMATCH");
	});
});
