import { describe, it, expect } from "vitest";
import { isDiagnoseLayer, isStageName } from "./diagnosis.ts";

describe("isDiagnoseLayer", () => {
	it("accepts valid layers", () => {
		expect(isDiagnoseLayer("intent-unclear")).toBe(true);
		expect(isDiagnoseLayer("spec-gap")).toBe(true);
		expect(isDiagnoseLayer("architecture-flaw")).toBe(true);
		expect(isDiagnoseLayer("wiring-bug")).toBe(true);
		expect(isDiagnoseLayer("implementation-bug")).toBe(true);
		expect(isDiagnoseLayer("test-gap")).toBe(true);
		expect(isDiagnoseLayer("cleanup-missed")).toBe(true);
	});

	it("rejects invalid layers", () => {
		expect(isDiagnoseLayer("invalid")).toBe(false);
		expect(isDiagnoseLayer("")).toBe(false);
	});
});

describe("isStageName", () => {
	it("accepts valid stage names", () => {
		expect(isStageName("init")).toBe(true);
		expect(isStageName("understand")).toBe(true);
		expect(isStageName("spec")).toBe(true);
		expect(isStageName("architecture")).toBe(true);
		expect(isStageName("wire")).toBe(true);
		expect(isStageName("resilience")).toBe(true);
		expect(isStageName("plan")).toBe(true);
		expect(isStageName("execute")).toBe(true);
		expect(isStageName("cleanup")).toBe(true);
		expect(isStageName("verify")).toBe(true);
	});

	it("rejects invalid names", () => {
		expect(isStageName("invalid")).toBe(false);
		expect(isStageName("")).toBe(false);
	});
});
