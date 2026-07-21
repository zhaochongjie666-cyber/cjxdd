import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runIsolated } from "./isolation.ts";

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const FILE_NAME = /^[a-z][a-z0-9_-]{0,63}\.mjs$/;
const SOURCE_LIMIT = 200_000;
const RESERVED_TOOLS = new Set(["bash", "edit", "find", "grep", "ls", "read", "write", "read_tool", "write_tool"]);

export interface DynamicToolModule {
	name: string;
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	promptSnippet?: string;
	promptGuidelines?: string[];
	hasExecute: boolean;
}

export function dynamicToolsDirectory(env = process.env): string {
	return resolve(env.XDD_DYNAMIC_TOOLS_DIR || fileURLToPath(new URL("./tools/", import.meta.url)));
}

function safeFileName(value: string): string {
	const name = basename(value.trim());
	if (name !== value.trim() || !FILE_NAME.test(name)) {
		throw new Error("文件名必须是小写字母开头、只含字母/数字/_/- 的 .mjs 文件");
	}
	return name;
}

function validateModule(value: unknown, file: string): DynamicToolModule {
	const tool = value as Partial<DynamicToolModule> | undefined;
	if (!tool || typeof tool !== "object") throw new Error(`${file}: default export 必须是对象`);
	if (typeof tool.name !== "string" || !TOOL_NAME.test(tool.name)) throw new Error(`${file}: name 必须匹配 ${TOOL_NAME}`);
	if (RESERVED_TOOLS.has(tool.name)) throw new Error(`${file}: 不允许覆盖保留工具 ${tool.name}`);
	if (typeof tool.label !== "string" || !tool.label.trim()) throw new Error(`${file}: label 不能为空`);
	if (typeof tool.description !== "string" || !tool.description.trim()) throw new Error(`${file}: description 不能为空`);
	if (!tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)) throw new Error(`${file}: parameters 必须是 JSON Schema 对象`);
	if (!tool.hasExecute) throw new Error(`${file}: execute 必须是函数`);
	return tool as DynamicToolModule;
}

export class DynamicToolRegistry {
	private pi: ExtensionAPI;
	readonly directory: string;
	private registered = new Map<string, string>();
	private watcher?: ReturnType<typeof watch>;

	constructor(pi: ExtensionAPI, directory = dynamicToolsDirectory()) { this.pi = pi; this.directory = directory; }

	ensureDirectory(): void { mkdirSync(this.directory, { recursive: true, mode: 0o700 }); }

	files(): string[] {
		this.ensureDirectory();
		return readdirSync(this.directory).filter((file) => FILE_NAME.test(file)).sort();
	}

	read(file: string): string { return readFileSync(join(this.directory, safeFileName(file)), "utf8"); }

	async load(file: string): Promise<DynamicToolModule> {
		const name = safeFileName(file);
		const path = join(this.directory, name);
		const tool = validateModule(await runIsolated({ mode: "inspect", modulePath: path, timeoutMs: 5_000 }), name);
		const previousFile = this.registered.get(tool.name);
		if (previousFile && previousFile !== name) throw new Error(`工具名 ${tool.name} 已由 ${previousFile} 注册`);
		this.registered.set(tool.name, name);
		this.pi.registerTool({
			name: tool.name,
			label: tool.label,
			description: tool.description,
			promptSnippet: tool.promptSnippet,
			promptGuidelines: tool.promptGuidelines,
			parameters: tool.parameters as never,
			async execute(_id, params, signal, _update, ctx) {
				const cwd = String(ctx?.cwd ?? process.cwd());
				const result = await runIsolated({ mode: "execute", modulePath: path, params, cwd, signal });
				if (result && typeof result === "object" && "content" in result) return result as never;
				const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
				return { content: [{ type: "text" as const, text: text ?? "null" }], details: { dynamicTool: tool.name } };
			},
		});
		return tool;
	}

	async loadAll(): Promise<{ loaded: string[]; errors: string[] }> {
		const loaded: string[] = [], errors: string[] = [];
		for (const file of this.files()) {
			try { loaded.push((await this.load(file)).name); } catch (error) { errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`); }
		}
		return { loaded, errors };
	}

	async write(file: string, source: string): Promise<DynamicToolModule> {
		const name = safeFileName(file);
		if (!source.trim() || source.length > SOURCE_LIMIT) throw new Error(`source 必须为 1-${SOURCE_LIMIT} 字符`);
		this.ensureDirectory();
		const target = join(this.directory, name);
		const temporary = join(this.directory, `.${name}.${process.pid}.tmp`);
		const previous = existsSync(target) ? readFileSync(target, "utf8") : undefined;
		writeFileSync(temporary, source, { encoding: "utf8", mode: 0o600 });
		try {
			renameSync(temporary, target);
			return await this.load(name);
		} catch (error) {
			rmSync(temporary, { force: true });
			if (previous === undefined) rmSync(target, { force: true });
			else writeFileSync(target, previous, { encoding: "utf8", mode: 0o600 });
			throw error;
		}
	}

	startWatching(onResult?: (message: string, error: boolean) => void): void {
		this.ensureDirectory();
		this.watcher?.close();
		const timers = new Map<string, ReturnType<typeof setTimeout>>();
		this.watcher = watch(this.directory, (_event, candidate) => {
			if (!candidate || !FILE_NAME.test(candidate)) return;
			const old = timers.get(candidate); if (old) clearTimeout(old);
			timers.set(candidate, setTimeout(async () => {
				timers.delete(candidate);
				if (!existsSync(join(this.directory, candidate))) return;
				try { const tool = await this.load(candidate); onResult?.(`动态工具已热更新：${tool.name}`, false); }
				catch (error) { onResult?.(`动态工具更新失败（保留上一版）：${candidate}: ${error instanceof Error ? error.message : String(error)}`, true); }
			}, 80));
		});
	}

	close(): void { this.watcher?.close(); }
}

export default function dynamicToolsExtension(pi: ExtensionAPI) {
	const registry = new DynamicToolRegistry(pi);
	pi.registerTool({
		name: "write_tool", label: "Write Tool",
		description: "把完整 ESM 工具源码写入本插件的 tools 目录。写入成功后插件立即将新工具注册到当前 coding agent 会话，无需重启。模块需 default export {name,label,description,parameters,execute(params,context)}。",
		promptSnippet: "在动态工具插件的 tools 目录编写并立即注册新工具",
		promptGuidelines: ["需要可复用能力时，用 write_tool 编写工具；成功后直接按模块中的 name 调用新工具。", "修改已有工具前先用 read_tool 读取源码。动态模块拥有本机代码权限，勿写入不可信代码。"],
		parameters: { type: "object", properties: {
			file: { type: "string", description: "插件 tools 目录内的 .mjs 文件名" },
			source: { type: "string", description: "工具的完整 ESM 源码" },
		}, required: ["file", "source"], additionalProperties: false },
		async execute(_id, params: { file: string; source: string }) {
			const tool = await registry.write(params.file, params.source);
			return { content: [{ type: "text" as const, text: `已写入 ${registry.directory}/${params.file}，并把 ${tool.name} 注册到当前会话；现在可以直接调用。` }], details: { name: tool.name, file: params.file, directory: registry.directory } };
		},
	});
	pi.registerTool({
		name: "read_tool", label: "Read Tool",
		description: "读取本插件 tools 目录中的动态工具源码；不传 file 时列出全部工具文件，供 AI 再次发现和修改。",
		promptSnippet: "列出或读取动态工具插件中的工具源码",
		parameters: { type: "object", properties: {
			file: { type: "string", description: "要读取的 .mjs 文件名；省略则列出 tools 目录" },
		}, additionalProperties: false },
		async execute(_id, params: { file?: string }) {
			const text = params.file ? registry.read(params.file) : JSON.stringify({ directory: registry.directory, files: registry.files() }, null, 2);
			return { content: [{ type: "text" as const, text }], details: { file: params.file, directory: registry.directory } };
		},
	});
	pi.on("session_start", async (_event, ctx) => {
		const result = await registry.loadAll();
		registry.startWatching((message, error) => ctx.ui.notify(message, error ? "error" : "info"));
		if (result.errors.length) ctx.ui.notify(`部分动态工具加载失败：\n${result.errors.join("\n")}`, "error");
		else if (result.loaded.length) ctx.ui.notify(`已加载动态工具：${result.loaded.join(", ")}`, "info");
	});
	pi.on("session_shutdown", () => registry.close());
}
