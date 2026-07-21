import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedProductionSources, evaluateProductionPathPolicy, findBusinessIdCodeDirectories, formatMissingProductionSources, isReviewableProductionSource } from "./production-path-policy.ts";

const roots: string[] = [];
const fresh = (): string => {
	const root = mkdtempSync(join(tmpdir(), "xdd-path-policy-"));
	roots.push(root);
	return root;
};

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("production path policy", () => {
	it("excludes dependency, generated, cache, test, and docs trees from source review", () => {
		expect(isReviewableProductionSource("backend/__init__.py")).toBe(true);
		expect(isReviewableProductionSource("node_modules/package/index.js")).toBe(false);
		expect(isReviewableProductionSource("frontend/node_modules/package/index.js")).toBe(false);
		expect(isReviewableProductionSource("dist/server.js")).toBe(false);
		expect(isReviewableProductionSource("tests/helper.py")).toBe(false);
	});

	it("keeps unignored node_modules out of changed source discovery", () => {
		const cwd = fresh();
		execFileSync("git", ["init", "-q"], { cwd });
		mkdirSync(join(cwd, "backend"), { recursive: true });
		mkdirSync(join(cwd, "node_modules/pkg"), { recursive: true });
		writeFileSync(join(cwd, "backend/__init__.py"), "");
		writeFileSync(join(cwd, "backend/service.py"), "VALUE = 1\n");
		writeFileSync(join(cwd, "node_modules/pkg/index.js"), "module.exports = 1\n");
		expect(changedProductionSources(cwd)).toEqual(["backend/__init__.py", "backend/service.py"]);
	});

	it("limits missing-source diagnostics and reports the hidden count", () => {
		const paths = Array.from({ length: 25 }, (_, index) => `src/file-${index}.ts`);
		const message = formatMissingProductionSources(paths);
		expect(message).toContain("src/file-19.ts");
		expect(message).not.toContain("src/file-20.ts");
		expect(message).toContain("另有 5 个未显示（总计 25 个）");
	});

	it("allows BXX identifiers inside XDD design artifacts", () => {
		const cwd = fresh();
		mkdirSync(join(cwd, ".xdd/design/spec/B01-auth"), { recursive: true });
		expect(findBusinessIdCodeDirectories(cwd)).toEqual([]);
		expect(evaluateProductionPathPolicy(cwd)).toEqual({ ok: true });
	});

	it("rejects business identifiers used as production directory names", () => {
		const cwd = fresh();
		mkdirSync(join(cwd, "backend/services/b01-auth"), { recursive: true });
		mkdirSync(join(cwd, "backend/services/project-service"), { recursive: true });
		expect(findBusinessIdCodeDirectories(cwd)).toEqual(["backend/services/b01-auth"]);
		expect(evaluateProductionPathPolicy(cwd)).toMatchObject({ ok: false });
	});

	it("allows semantic production directory names", () => {
		const cwd = fresh();
		mkdirSync(join(cwd, "backend/services/auth-service"), { recursive: true });
		mkdirSync(join(cwd, "backend/services/project-service"), { recursive: true });
		expect(evaluateProductionPathPolicy(cwd)).toEqual({ ok: true });
	});
});
