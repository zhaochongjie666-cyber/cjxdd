import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateProductionPathPolicy, findBusinessIdCodeDirectories } from "./production-path-policy.ts";

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
