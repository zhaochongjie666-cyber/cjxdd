import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import readDirExtension, { readDir } from "./index.ts";

describe("read_dir", () => {
	it("递归并一次返回全部文本文件，且保持稳定顺序", () => {
		const cwd = mkdtempSync(join(tmpdir(), "read-dir-"));
		try {
			mkdirSync(join(cwd, "spec", "nested"), { recursive: true });
			writeFileSync(join(cwd, "spec", "b.md"), "B");
			writeFileSync(join(cwd, "spec", "nested", "a.md"), "A");
			const result = readDir(cwd, { paths: ["spec"] });
			expect(result.text).toContain("一次读取 2/2 个文件");
			expect(result.text.indexOf("spec/b.md")).toBeLessThan(result.text.indexOf("spec/nested/a.md"));
		} finally { rmSync(cwd, { recursive: true, force: true }); }
	});

	it("兜底拒绝项目外符号链接，并报告缺失路径与截断", () => {
		const cwd = mkdtempSync(join(tmpdir(), "read-dir-"));
		const outside = mkdtempSync(join(tmpdir(), "read-dir-outside-"));
		try {
			writeFileSync(join(cwd, "large.md"), "123456789");
			writeFileSync(join(outside, "secret.md"), "secret");
			symlinkSync(join(outside, "secret.md"), join(cwd, "escape.md"));
			const result = readDir(cwd, { paths: ["large.md", "escape.md", "missing.md"], maxFileChars: 4 });
			expect(result.text).toContain("1234");
			expect(result.text).not.toContain("secret\n");
			expect(result.details.rejected).toEqual(["escape.md"]);
			expect(result.details.missing).toEqual(["missing.md"]);
		} finally { rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
	});

	it("严格遵守总字符上限", () => {
		const cwd = mkdtempSync(join(tmpdir(), "read-dir-"));
		try {
			writeFileSync(join(cwd, "data.md"), "x".repeat(100));
			const result = readDir(cwd, { paths: ["data.md"], maxTotalChars: 30 });
			expect(result.details.chars).toBeLessThanOrEqual(30);
			expect(result.details.truncated).toEqual(["data.md"]);
		} finally { rmSync(cwd, { recursive: true, force: true }); }
	});

	it("拒绝一次读取整个 design，并提示按设计锚分批读取", () => {
		const cwd = mkdtempSync(join(tmpdir(), "read-dir-"));
		try {
			mkdirSync(join(cwd, ".xdd", "design", "spec"), { recursive: true });
			writeFileSync(join(cwd, ".xdd", "design", "design.md"), "design");
			symlinkSync(join(cwd, ".xdd", "design"), join(cwd, "design-alias"));
			expect(() => readDir(cwd, { paths: [".xdd/design"] })).toThrow(/禁止整目录一次读取.*spec\/.*architecture\/.*wire\/.*resilience\//);
			expect(() => readDir(cwd, { paths: [".xdd/design/"] })).toThrow(/禁止整目录一次读取/);
			expect(() => readDir(cwd, { paths: [".xdd"] })).toThrow(/禁止整目录一次读取/);
			expect(() => readDir(cwd, { paths: ["design-alias"] })).toThrow(/禁止整目录一次读取/);
		} finally { rmSync(cwd, { recursive: true, force: true }); }
	});

	it("允许按 design 文件和子目录分批读取", () => {
		const cwd = mkdtempSync(join(tmpdir(), "read-dir-"));
		try {
			mkdirSync(join(cwd, ".xdd", "design", "spec"), { recursive: true });
			writeFileSync(join(cwd, ".xdd", "design", "design.md"), "design");
			writeFileSync(join(cwd, ".xdd", "design", "spec", "rules.md"), "rules");
			const anchors = readDir(cwd, { paths: [".xdd/design/design.md"] });
			const spec = readDir(cwd, { paths: [".xdd/design/spec"] });
			expect(anchors.text).toContain(".xdd/design/design.md");
			expect(spec.text).toContain(".xdd/design/spec/rules.md");
		} finally { rmSync(cwd, { recursive: true, force: true }); }
	});

	it("注册单个 read_dir 工具", () => {
		const tools: unknown[] = [];
		readDirExtension({ registerTool(tool: unknown) { tools.push(tool); } } as never);
		expect(tools).toHaveLength(1);
		expect((tools[0] as { name: string }).name).toBe("read_dir");
	});
});
