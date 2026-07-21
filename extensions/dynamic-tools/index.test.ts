import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import dynamicToolsExtension, { dynamicToolsDirectory, DynamicToolRegistry } from "./index.ts";
import { runIsolated } from "./isolation.ts";

const source = (prefix: string, name = "hello_dynamic") => `export default {
 name: ${JSON.stringify(name)}, label: "Hello", description: "Greets", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
 execute({name}) { return ${JSON.stringify(prefix)} + name; }
}`;

test("writes, registers, rereads and hot-reloads a dynamic tool", async () => {
	const directory = mkdtempSync(join(tmpdir(), "xdd-dynamic-"));
	const tools = new Map<string, any>();
	const registry = new DynamicToolRegistry({ registerTool(tool: any) { tools.set(tool.name, tool); } } as never, directory);
	try {
		await registry.write("hello.mjs", source("hi "));
		assert.match(readFileSync(join(directory, "hello.mjs"), "utf8"), /hello_dynamic/);
		assert.deepEqual(registry.files(), ["hello.mjs"]);
		assert.match(registry.read("hello.mjs"), /Greets/);
		assert.equal((await tools.get("hello_dynamic").execute("1", { name: "Ada" })).content[0].text, "hi Ada");

		writeFileSync(join(directory, "hello.mjs"), source("bye "));
		await registry.load("hello.mjs");
		assert.equal((await tools.get("hello_dynamic").execute("2", { name: "Ada" })).content[0].text, "bye Ada");
	} finally { registry.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("watches the plugin tools directory and registers a new file without restart", async () => {
	const directory = mkdtempSync(join(tmpdir(), "xdd-dynamic-"));
	const tools = new Map<string, any>();
	const registry = new DynamicToolRegistry({ registerTool(tool: any) { tools.set(tool.name, tool); } } as never, directory);
	try {
		const updated = new Promise<string>((resolve, reject) => {
			registry.startWatching((message, error) => error ? reject(new Error(message)) : resolve(message));
		});
		writeFileSync(join(directory, "watched.mjs"), source("live ", "watched_tool"));
		assert.match(await updated, /watched_tool/);
		assert.equal((await tools.get("watched_tool").execute("3", { name: "Ada" })).content[0].text, "live Ada");
	} finally { registry.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("registers separate read_tool/write_tool bootstrap tools and defaults beside the plugin", () => {
	const tools = new Map<string, any>();
	const events = new Map<string, Function>();
	dynamicToolsExtension({
		registerTool(tool: any) { tools.set(tool.name, tool); },
		on(name: string, handler: Function) { events.set(name, handler); },
	} as never);
	assert.deepEqual([...tools.keys()], ["write_tool", "read_tool"]);
	assert.ok(events.has("session_start"));
	assert.ok(events.has("session_shutdown"));
	assert.match(dynamicToolsDirectory({} as NodeJS.ProcessEnv), /dynamic-tools[\\/]tools$/);
});

test("rejects traversal, invalid modules, and duplicate tool names", async () => {
	const directory = mkdtempSync(join(tmpdir(), "xdd-dynamic-"));
	const registry = new DynamicToolRegistry({ registerTool() {} } as never, directory);
	try {
		await assert.rejects(() => registry.write("../escape.mjs", source("x")), /文件名/);
		await assert.rejects(() => registry.write("bad.mjs", "export default { name: 'bad' }"), /label/);
		await assert.rejects(() => registry.write("bash.mjs", source("x", "bash")), /不允许覆盖保留工具/);
		await registry.write("one.mjs", source("one", "same_name"));
		await assert.rejects(() => registry.write("two.mjs", source("two", "same_name")), /已由 one\.mjs 注册/);
		assert.deepEqual(registry.files(), ["one.mjs"]);
	} finally { registry.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("isolates process.exit and infinite loops from the agent process", async () => {
	const directory = mkdtempSync(join(tmpdir(), "xdd-dynamic-"));
	try {
		const exits = join(directory, "exit.mjs");
		writeFileSync(exits, "export default { execute() { process.exit(23) } }");
		await assert.rejects(() => runIsolated({ mode: "execute", modulePath: exits, timeoutMs: 1_000 }), /隔离进程异常退出/);

		const loops = join(directory, "loop.mjs");
		writeFileSync(loops, "export default { execute() { while (true) {} } }");
		await assert.rejects(() => runIsolated({ mode: "execute", modulePath: loops, timeoutMs: 100 }), /超过 100ms/);
		assert.equal(process.exitCode, undefined);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});
