import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	gitHasChanges,
	requireGlobs,
	requireGlobsWithKeywords,
	requireGlobsWithMinSize,
	softPass,
} from "./gate.ts";

describe("softPass", () => {
	it("returns ok with soft flag", () => {
		const result = softPass();
		expect(result.ok).toBe(true);
		expect(result.soft).toBe(true);
	});
});

describe("requireGlobs", () => {
	it("fails on empty patterns", async () => {
		const result = await requireGlobs("/tmp", []);
		expect(result.ok).toBe(false);
	});

	it("passes when literal file exists", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-"));
		try {
			writeFileSync(join(dir, "spec.md"), "# spec");
			const result = await requireGlobs(dir, ["spec.md"]);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("fails when file does not exist", async () => {
		const result = await requireGlobs("/tmp", ["nonexistent-xyz.md"]);
		expect(result.ok).toBe(false);
	});

	it("passes on glob match", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-"));
		try {
			mkdirSync(join(dir, "docs"), { recursive: true });
			writeFileSync(join(dir, "docs", "spec.md"), "# spec");
			const result = await requireGlobs(dir, ["docs/*.md"]);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("passes when any one of multiple patterns matches", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-"));
		try {
			writeFileSync(join(dir, "architecture.md"), "# arch");
			const result = await requireGlobs(dir, ["docs/spec.md", "spec.md", "architecture.md"]);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});

describe("gitHasChanges", () => {
	it("soft passes on non-git directory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-"));
		try {
			const result = await gitHasChanges(dir);
			expect(result.ok).toBe(true);
			expect(result.soft).toBe(true);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});

describe("requireGlobsWithKeywords", () => {
	it("passes when file has enough keywords", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-"));
		try {
			writeFileSync(join(dir, "spec.md"), "# Spec\n接口: foo\nschema: bar\n错误: baz");
			const result = await requireGlobsWithKeywords(dir, ["spec.md"], ["接口", "schema", "错误"], 2);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("fails when not enough keywords", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-"));
		try {
			writeFileSync(join(dir, "spec.md"), "# Spec\nonly one keyword: 接口");
			const result = await requireGlobsWithKeywords(dir, ["spec.md"], ["接口", "schema", "错误"], 2);
			expect(result.ok).toBe(false);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("fails when file does not exist", async () => {
		const result = await requireGlobsWithKeywords("/tmp", ["nonexistent.md"], ["a"], 1);
		expect(result.ok).toBe(false);
	});

	it("passes on glob match with enough keywords", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-"));
		try {
			mkdirSync(join(dir, ".xdd", "design", "architecture", "B01"), { recursive: true });
			writeFileSync(join(dir, ".xdd", "design", "architecture", "B01", "architecture.md"), "# Arch\n模块: x\n依赖: y\n数据流: z\n失败: w");
			const result = await requireGlobsWithKeywords(dir, [".xdd/design/architecture/**/architecture.md"], ["模块", "依赖", "数据流", "失败"], 2);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("fails on glob match without enough keywords", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-"));
		try {
			mkdirSync(join(dir, ".xdd", "design", "architecture", "B01"), { recursive: true });
			writeFileSync(join(dir, ".xdd", "design", "architecture", "B01", "architecture.md"), "# Arch\n模块: x");
			const result = await requireGlobsWithKeywords(dir, [".xdd/design/architecture/**/architecture.md"], ["模块", "依赖", "数据流", "失败"], 2);
			expect(result.ok).toBe(false);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});

describe("requireGlobsWithMinSize", () => {
	it("passes when file is large enough", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-"));
		try {
			writeFileSync(join(dir, "plan.md"), "# Plan\n".repeat(20));
			const result = await requireGlobsWithMinSize(dir, ["plan.md"], 100);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("fails when file is too small", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-"));
		try {
			writeFileSync(join(dir, "plan.md"), "# Plan");
			const result = await requireGlobsWithMinSize(dir, ["plan.md"], 100);
			expect(result.ok).toBe(false);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("passes on glob match with large enough file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xdd-"));
		try {
			mkdirSync(join(dir, ".xdd", "design", "architecture", "B01", "resilience"), { recursive: true });
			writeFileSync(join(dir, ".xdd", "design", "architecture", "B01", "resilience", "failure-modes.md"), "# FM\n".repeat(20));
			const result = await requireGlobsWithMinSize(dir, [".xdd/design/architecture/**/resilience/failure-modes.md"], 100);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});
