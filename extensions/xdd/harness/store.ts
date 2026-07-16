import { existsSync, mkdirSync, openSync, readFileSync, renameSync, closeSync, fsyncSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EMPTY_HARNESS, type HarnessOperation, type HarnessSection, type XddHarness, normalizeHarness } from "./schema.ts";

export const HARNESS_PATH = ".xdd/harness.yml";

export class HarnessStore {
	readonly cwd: string;
	readonly path: string;

	constructor(cwd: string) {
		this.cwd = cwd;
		this.path = join(cwd, HARNESS_PATH);
	}

	load(): XddHarness {
		if (!existsSync(this.path)) return normalizeHarness(EMPTY_HARNESS);
		return normalizeHarness(parseHarnessYaml(readFileSync(this.path, "utf8")));
	}

	save(harness: XddHarness): XddHarness {
		const next = normalizeHarness(harness);
		atomicWriteText(this.path, serializeHarnessYaml(next));
		return next;
	}

	update(section: HarnessSection, operation: HarnessOperation, value: unknown): XddHarness {
		const current = this.load();
		const next = applyHarnessUpdate(current, section, operation, value);
		return this.save(next);
	}
}

export function applyHarnessUpdate(harness: XddHarness, section: HarnessSection, operation: HarnessOperation, value: unknown): XddHarness {
	const draft = normalizeHarness(harness);
	if (section === "环境" || section === "项目") {
		const incoming = recordFrom(value);
		if (operation === "replace") (draft[section] as Record<string, string>) = incoming;
		else if (operation === "merge" || operation === "append") Object.assign(draft[section], incoming);
		else if (operation === "remove") {
			const keys = Array.isArray(value) ? value.map(String) : Object.keys(incoming);
			for (const key of keys) delete draft[section][key];
		}
		return normalizeHarness(draft);
	}
	const list = draft[section] as string[];
	const incoming = listFrom(value);
	if (operation === "replace") (draft[section] as string[]) = incoming;
	else if (operation === "append" || operation === "merge") list.push(...incoming);
	else if (operation === "remove") (draft[section] as string[]) = list.filter((item) => !incoming.includes(item));
	return normalizeHarness(draft);
}

export function parseHarnessYaml(text: string): Partial<XddHarness> {
	const out: Partial<XddHarness> = {};
	let section: HarnessSection | "schemaVersion" | undefined;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, "");
		if (!line.trim()) continue;
		const top = /^(schemaVersion|环境|项目|验证命令|调试工具|调试任务|工作记忆):\s*(.*)$/.exec(line);
		if (top && !rawLine.startsWith(" ")) {
			section = top[1] as HarnessSection | "schemaVersion";
			if (section === "schemaVersion") out.schemaVersion = Number(top[2]) as 1;
			else if (section === "环境" || section === "项目") (out[section] as Record<string, string>) = {};
			else (out[section] as string[]) = [];
			continue;
		}
		if (!section || section === "schemaVersion") continue;
		if (section === "环境" || section === "项目") {
			const kv = /^\s+([^:]+):\s*(.*)$/.exec(rawLine);
			if (kv) (out[section] as Record<string, string>)[kv[1].trim()] = unquote(kv[2].trim());
		} else {
			const item = /^\s*-\s*(.*)$/.exec(rawLine);
			if (item) (out[section] as string[]).push(unquote(item[1].trim()));
		}
	}
	return out;
}

export function serializeHarnessYaml(harness: XddHarness): string {
	const lines: string[] = ["schemaVersion: 1", "环境:"];
	for (const [key, value] of Object.entries(harness.环境)) lines.push(`  ${key}: ${quote(value)}`);
	lines.push("项目:");
	for (const [key, value] of Object.entries(harness.项目)) lines.push(`  ${key}: ${quote(value)}`);
	for (const section of ["验证命令", "调试工具", "调试任务", "工作记忆"] as const) {
		lines.push(`${section}:`);
		for (const item of harness[section]) lines.push(`  - ${quote(item)}`);
	}
	return `${lines.join("\n")}\n`;
}

function atomicWriteText(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	const fd = openSync(tmp, "w");
	try {
		writeFileSync(fd, text, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(tmp, path);
}

function listFrom(value: unknown): string[] {
	return (Array.isArray(value) ? value : [value]).filter((item) => item !== undefined && item !== null).map(String);
}

function recordFrom(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(Object.entries(value).map(([key, raw]) => [key, String(raw ?? "")]));
}

function quote(value: string): string {
	return JSON.stringify(value);
}

function unquote(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		try { return JSON.parse(value); } catch { return value.slice(1, -1); }
	}
	return value;
}
