import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("xdd subagent production smoke script", () => {
	it("uses env-based API key and avoids persisting secrets", () => {
		const script = join(process.cwd(), "extensions", "xdd-subagents", "scripts", "smoke-pi.sh");
		expect(existsSync(script)).toBe(true);
		const text = readFileSync(script, "utf8");
		expect(text).toContain("MINIMAX_CN_API_KEY");
		expect(text).toContain("minimax-cn");
		expect(text).toContain("MINIMAX_API_KEY");
		expect(text).toContain("--no-session");
		expect(text).toContain("pi \\");
		expect(text).not.toContain("sk-cp-");
	});
});
