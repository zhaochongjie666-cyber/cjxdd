import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "nf-rollback.ts"), "utf8");

describe("nf_rollback source contract", () => {
	it("allows cross-stage flow self-heal only from verify", () => {
		expect(SRC).toContain('if (from !== "verify")');
		expect(SRC).toContain("Normal Flow 只允许 verify 阶段跨流程回退自愈");
		expect(SRC).toContain('verify: "spec"');
		expect(SRC).toContain("可回 architecture 重搭框架");
		expect(SRC).toContain("设计根因回 understand");
		expect(SRC).not.toContain('verify: "execute"');
	});
});
