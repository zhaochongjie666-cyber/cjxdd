import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import readAllExtension, { readAll } from "./index.ts";

describe("read_all", () => {
	it("递归并一次返回全部文本文件，且保持稳定顺序", () => {
		const cwd = mkdtempSync(join(tmpdir(), "read-all-"));
		try {
			mkdirSync(join(cwd, "spec", "nested"), { recursive: true });
			writeFileSync(join(cwd, "spec", "b.md"), "B");
			writeFileSync(join(cwd, "spec", "nested", "a.md"), "A");
			const result = readAll(cwd, { paths: ["spec"] });
			expect(result.text).toContain("一次读取 2/2 个文件");
			expect(result.text.indexOf("spec/b.md")).toBeLessThan(result.text.indexOf("spec/nested/a.md"));
		} finally { rmSync(cwd, { recursive: true, force: true }); }
	});

	it("兜底拒绝项目外符号链接，并报告缺失路径与截断", () => {
		const cwd = mkdtempSync(join(tmpdir(), "read-all-"));
		const outside = mkdtempSync(join(tmpdir(), "read-all-outside-"));
		try {
			writeFileSync(join(cwd, "large.md"), "123456789");
			writeFileSync(join(outside, "secret.md"), "secret");
			symlinkSync(join(outside, "secret.md"), join(cwd, "escape.md"));
			const result = readAll(cwd, { paths: ["large.md", "escape.md", "missing.md"], maxFileChars: 4 });
			expect(result.text).toContain("1234");
			expect(result.text).not.toContain("secret\n");
			expect(result.details.rejected).toEqual(["escape.md"]);
			expect(result.details.missing).toEqual(["missing.md"]);
		} finally { rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
	});

	it("严格遵守总字符上限", () => {
		const cwd = mkdtempSync(join(tmpdir(), "read-all-"));
		try {
			writeFileSync(join(cwd, "data.md"), "x".repeat(100));
			const result = readAll(cwd, { paths: ["data.md"], maxTotalChars: 30 });
			expect(result.details.chars).toBeLessThanOrEqual(30);
			expect(result.details.truncated).toEqual(["data.md"]);
		} finally { rmSync(cwd, { recursive: true, force: true }); }
	});

	it("注册单个 read_all 工具", () => {
		const tools: unknown[] = [];
		readAllExtension({ registerTool(tool: unknown) { tools.push(tool); } } as never);
		expect(tools).toHaveLength(1);
		expect((tools[0] as { name: string }).name).toBe("read_all");
	});
});
