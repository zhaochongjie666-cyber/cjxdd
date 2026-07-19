import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { countTodo, locateItem, newItem, readTodo, renderTodo, TODO_FILE, todoPath, writeTodo, type TodoDocument } from "./store.ts";

const emptyParameters = { type: "object", properties: {}, additionalProperties: false } as const;
const text = (value: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: value }], details });

export default function todoList(pi: ExtensionAPI) {
	pi.registerTool({
		name: "todo_create",
		label: "Create ToDo List",
		description: `在当前项目创建 ${TODO_FILE}。先把任务和子任务落笔，再逐项执行；已有文档时默认拒绝覆盖。`,
		parameters: {
			type: "object", properties: {
				title: { type: "string", description: "文档标题，默认 ToDo List" },
				tasks: { type: "array", description: "初始任务", items: { type: "object", properties: { title: { type: "string" }, subtasks: { type: "array", items: { type: "string" } } }, required: ["title"], additionalProperties: false } },
				overwrite: { type: "boolean", description: "明确设为 true 才覆盖已有 TODO.md" },
			}, required: ["tasks"], additionalProperties: false,
		},
		async execute(_id, params: { title?: string; tasks: Array<{ title: string; subtasks?: string[] }>; overwrite?: boolean }, _update, ctx) {
			const cwd = String(ctx?.cwd ?? process.cwd());
			if (existsSync(todoPath(cwd)) && !params.overwrite) throw new Error(`[todo_create] ${TODO_FILE} 已存在；请用 todo_update 修改，或明确传 overwrite=true`);
			const document: TodoDocument = { title: params.title?.trim() || "ToDo List", items: params.tasks.map((task) => newItem(task.title, task.subtasks)) };
			writeTodo(cwd, document);
			return text(`[todo_create] 已创建 ${TODO_FILE}\n${renderTodo(document)}`, { path: todoPath(cwd), ...countTodo(document) });
		},
	});

	pi.registerTool({
		name: "todo_update",
		label: "Update ToDo List",
		description: "新增、完成、恢复、改名或删除任务/子任务。target/parent 使用 todo_view 显示的编号，如 2 或 2.1。完成父任务会同时完成其全部子任务。",
		parameters: {
			type: "object", properties: {
				action: { type: "string", enum: ["add", "complete", "reopen", "rename", "remove"] },
				target: { type: "string", description: "要操作的任务编号" },
				parent: { type: "string", description: "add 时可选的父任务编号；省略则新增顶层任务" },
				title: { type: "string", description: "add/rename 所需任务内容" },
			}, required: ["action"], additionalProperties: false,
		},
		async execute(_id, params: { action: "add" | "complete" | "reopen" | "rename" | "remove"; target?: string; parent?: string; title?: string }, _update, ctx) {
			const cwd = String(ctx?.cwd ?? process.cwd());
			const document = readTodo(cwd);
			if (params.action === "add") {
				if (!params.title) throw new Error("[todo_update] add 必须提供 title");
				const siblings = params.parent ? locateItem(document, params.parent).item.children : document.items;
				siblings.push(newItem(params.title));
			} else {
				if (!params.target) throw new Error(`[todo_update] ${params.action} 必须提供 target`);
				const found = locateItem(document, params.target);
				if (params.action === "remove") found.siblings.splice(found.index, 1);
				else if (params.action === "rename") {
					if (!params.title) throw new Error("[todo_update] rename 必须提供 title");
					found.item.title = newItem(params.title).title;
				} else {
					const done = params.action === "complete";
					const mark = (item: typeof found.item) => { item.done = done; item.children.forEach(mark); };
					mark(found.item);
				}
			}
			writeTodo(cwd, document);
			return text(`[todo_update] ${params.action} 完成\n${renderTodo(document)}`, { path: todoPath(cwd), ...countTodo(document) });
		},
	});

	pi.registerTool({
		name: "todo_view",
		label: "View ToDo List",
		description: "查看当前项目的 ToDo List、稳定的本次任务编号和完成统计。任务结束/退出前必须调用一次，确认没有遗漏。",
		parameters: emptyParameters,
		async execute(_id, _params, _update, ctx) {
			const cwd = String(ctx?.cwd ?? process.cwd());
			const document = readTodo(cwd);
			const lines: string[] = [];
			const visit = (items: typeof document.items, prefix = "") => items.forEach((item, index) => {
				const id = `${prefix}${index + 1}`;
				lines.push(`${"  ".repeat(id.split(".").length - 1)}${id}. [${item.done ? "x" : " "}] ${item.title}`);
				visit(item.children, `${id}.`);
			});
			visit(document.items);
			const counts = countTodo(document);
			return text(`[todo_view] ${TODO_FILE}：${counts.done}/${counts.total} 已完成，${counts.pending} 待办\n${lines.join("\n") || "（空清单）"}`, { path: todoPath(cwd), ...counts });
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		const cwd = String(ctx?.cwd ?? process.cwd());
		if (!existsSync(todoPath(cwd))) return;
		try {
			const counts = countTodo(readTodo(cwd));
			ctx.ui.notify(`[todo] 退出前检查：${counts.done}/${counts.total} 已完成，${counts.pending} 待办。请以 ${TODO_FILE} 为准。`, counts.pending ? "warning" : "info");
		} catch (error) {
			ctx.ui.notify(`[todo] 退出前无法读取 ${TODO_FILE}: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	});
}
