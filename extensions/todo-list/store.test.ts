import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countTodo, locateItem, newItem, parseTodo, readTodo, renderTodo, writeTodo } from "./store.ts";

describe("todo-list store", () => {
	it("round-trips tasks and nested tasks as Markdown", () => {
		const document = { title: "发布", items: [newItem("实现", ["正向测试", "兜底测试"])] };
		expect(parseTodo(renderTodo(document))).toEqual(document);
		expect(countTodo(document)).toEqual({ total: 3, done: 0, pending: 3 });
		expect(locateItem(document, "1.2").item.title).toBe("兜底测试");
	});

	it("writes atomically and rejects missing or invalid targets", () => {
		const cwd = mkdtempSync(join(tmpdir(), "todo-list-"));
		try {
			const document = { title: "ToDo List", items: [newItem("任务")] };
			writeTodo(cwd, document);
			expect(readTodo(cwd)).toEqual(document);
			expect(readFileSync(join(cwd, "TODO.md"), "utf8")).toContain("- [ ] 任务");
			expect(() => locateItem(document, "2")).toThrow("找不到任务");
			expect(() => locateItem(document, "bad")).toThrow("无效任务编号");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
