import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tools", "nf-submit-artifact.ts"), "utf8");

describe("nf_submit_artifact retry safety", () => {
	it("pins literal artifact existence checks before controller submission", () => {
		expect(SRC).toContain("声明的产物必须先真的落盘");
		expect(SRC).toContain("existsSync(join(state.cwd, p))");
		expect(SRC).toContain("RECORD_ARTIFACT_REVIEW");
		expect(SRC.indexOf("existsSync(join(state.cwd, p))")).toBeLessThan(SRC.indexOf("RECORD_ARTIFACT_REVIEW"));
	});

	it("rejects unchanged repeated artifact submissions before spending gate budget", () => {
		expect(SRC).toContain("computeArtifactFingerprint");
		expect(SRC).toContain("checkAndRecordSubmitFingerprint");
		expect(SRC).toContain("上次提交后磁盘产物未变化");
		expect(SRC.indexOf("checkAndRecordSubmitFingerprint")).toBeLessThan(SRC.indexOf("beginSelfHealAttempt"));
	});
});
