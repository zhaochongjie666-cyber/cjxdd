import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import todoList from "./index.ts";

type RegisteredTool = { name: string; execute: (...args: any[]) => Promise<any> };

function harness() {
	const tools = new Map<string, RegisteredTool>();
	const sentMessages: Array<{ text: string; options: unknown }> = [];
	let agentEnd: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	todoList({
		registerTool(tool: RegisteredTool) { tools.set(tool.name, tool); },
		on(event: string, handler: typeof agentEnd) { if (event === "agent_end") agentEnd = handler; },
		async sendUserMessage(text: string, options: unknown) { sentMessages.push({ text, options }); },
	} as any);
	return { tools, sentMessages, getAgentEnd: () => agentEnd };
}

describe("todo-list extension", () => {
	it("registers exactly the three document tools and supports the full workflow", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "todo-tools-"));
		try {
			const app = harness();
			expect([...app.tools.keys()]).toEqual(["todo_create", "todo_update", "todo_view"]);
			const context = { cwd };
			await app.tools.get("todo_create")!.execute("id", { tasks: [{ title: "发布", subtasks: ["攻击检查"] }] }, undefined, context);
			await expect(app.tools.get("todo_create")!.execute("id", { tasks: [] }, undefined, context)).rejects.toThrow("已存在");
			await app.tools.get("todo_update")!.execute("id", { action: "complete", target: "1.1" }, undefined, context);
			await app.tools.get("todo_update")!.execute("id", { action: "add", parent: "1", title: "回炉重造" }, undefined, context);
			const result = await app.tools.get("todo_view")!.execute("id", {}, undefined, context);
			expect(result.content[0].text).toContain("1/3 已完成，2 待办");
			expect(result.content[0].text).toContain("1.2. [ ] 回炉重造");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("checks pending work at agent end", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "todo-exit-"));
		try {
			const app = harness();
			await app.tools.get("todo_create")!.execute("id", { tasks: [{ title: "未完成" }] }, undefined, { cwd });
			const notifications: unknown[][] = [];
			await app.getAgentEnd()!({}, { cwd, ui: { notify: (...args: unknown[]) => notifications.push(args) } });
			expect(notifications).toEqual([["[todo] 退出前检查：0/1 已完成，1 待办。请以 TODO.md 为准。", "warning"]]);
			expect(app.sentMessages).toEqual([{
				text: "[todo continuation] TODO.md 仍有 1 项待办。不要退出或只汇报当前流程已完成；立即调用 todo_view，继续执行并逐项完成 TODO.md 中的剩余任务。",
				options: { deliverAs: "steer" },
			}]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("does not steer when every todo is complete", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "todo-complete-"));
		try {
			const app = harness();
			await app.tools.get("todo_create")!.execute("id", { tasks: [{ title: "已完成" }] }, undefined, { cwd });
			await app.tools.get("todo_update")!.execute("id", { action: "complete", target: "1" }, undefined, { cwd });
			await app.getAgentEnd()!({}, { cwd, ui: { notify: () => undefined } });
			expect(app.sentMessages).toEqual([]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
