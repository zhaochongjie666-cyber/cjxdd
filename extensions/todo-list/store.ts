import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TODO_FILE = "TODO.md";

export interface TodoItem {
	title: string;
	done: boolean;
	children: TodoItem[];
}

export interface TodoDocument {
	title: string;
	items: TodoItem[];
}

const ITEM = /^(\s*)- \[([ xX])\] (.+)$/;

function validateTitle(title: string): string {
	const value = title.trim();
	if (!value) throw new Error("任务内容不能为空");
	if (value.includes("\n") || value.includes("\r")) throw new Error("任务内容不能包含换行");
	return value;
}

export function todoPath(cwd: string): string {
	return join(cwd, TODO_FILE);
}

export function parseTodo(markdown: string): TodoDocument {
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	const heading = lines.find((line) => /^#\s+/.test(line));
	const document: TodoDocument = { title: heading?.replace(/^#\s+/, "").trim() || "ToDo List", items: [] };
	const stack: Array<{ indent: number; item: TodoItem }> = [];
	for (const line of lines) {
		const match = ITEM.exec(line);
		if (!match) continue;
		const indent = match[1]!.replace(/\t/g, "  ").length;
		const item: TodoItem = { done: match[2]!.toLowerCase() === "x", title: validateTitle(match[3]!), children: [] };
		while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
		if (stack.length) stack[stack.length - 1]!.item.children.push(item);
		else document.items.push(item);
		stack.push({ indent, item });
	}
	return document;
}

export function renderTodo(document: TodoDocument): string {
	const lines = [`# ${document.title}`, ""];
	const visit = (items: TodoItem[], depth: number) => {
		for (const item of items) {
			lines.push(`${"  ".repeat(depth)}- [${item.done ? "x" : " "}] ${item.title}`);
			visit(item.children, depth + 1);
		}
	};
	visit(document.items, 0);
	return `${lines.join("\n")}\n`;
}

export function readTodo(cwd: string): TodoDocument {
	const path = todoPath(cwd);
	if (!existsSync(path)) throw new Error(`[todo] ${TODO_FILE} 不存在；请先调用 todo_create`);
	return parseTodo(readFileSync(path, "utf8"));
}

export function writeTodo(cwd: string, document: TodoDocument): void {
	const path = todoPath(cwd);
	const temporary = `${path}.tmp-${process.pid}`;
	try {
		writeFileSync(temporary, renderTodo(document), { encoding: "utf8", flag: "wx" });
		renameSync(temporary, path);
	} finally {
		if (existsSync(temporary)) rmSync(temporary);
	}
}

export function locateItem(document: TodoDocument, target: string): { item: TodoItem; siblings: TodoItem[]; index: number } {
	const indexes = target.split(".").map((part) => Number(part) - 1);
	if (!indexes.length || indexes.some((value) => !Number.isInteger(value) || value < 0)) throw new Error(`无效任务编号: ${target}`);
	let siblings = document.items;
	let item: TodoItem | undefined;
	let index = -1;
	for (let depth = 0; depth < indexes.length; depth++) {
		const next = indexes[depth]!;
		index = next;
		item = siblings[next];
		if (!item) throw new Error(`找不到任务: ${target}`);
		if (depth < indexes.length - 1) siblings = item.children;
	}
	return { item: item!, siblings, index };
}

export function countTodo(document: TodoDocument): { total: number; done: number; pending: number } {
	let total = 0;
	let done = 0;
	const visit = (items: TodoItem[]) => items.forEach((item) => { total++; if (item.done) done++; visit(item.children); });
	visit(document.items);
	return { total, done, pending: total - done };
}

export function newItem(title: string, children: string[] = []): TodoItem {
	return { title: validateTitle(title), done: false, children: children.map((child) => newItem(child)) };
}
