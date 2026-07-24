/** NF 自包含 harness（项目操作手册）。 */
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, closeSync, fsyncSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface NfHarness {
	schemaVersion: 1;
	环境: Record<string, string>;
	项目: Record<string, string>;
	验证命令: string[];
	调试工具: string[];
	调试任务: string[];
	工作记忆: string[];
}

const EMPTY: NfHarness = { schemaVersion: 1, 环境: {}, 项目: {}, 验证命令: [], 调试工具: [], 调试任务: [], 工作记忆: [] };
const HARNESS_PATH = ".xdd/harness.yml";

export class HarnessStore {
	readonly path: string;
	constructor(readonly cwd: string) { this.path = join(cwd, HARNESS_PATH); }
	load(): NfHarness { return existsSync(this.path) ? normalize(parseYaml(readFileSync(this.path, "utf8"))) : normalize(EMPTY); }
	save(h: NfHarness): NfHarness { const next = normalize(h); atomicWrite(this.path, serializeYaml(next)); return next; }
	update(section: keyof NfHarness, op: "replace" | "append" | "remove" | "merge", value: unknown): NfHarness {
		const cur = this.load();
		if (section === "环境" || section === "项目") {
			const rec = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {};
			if (op === "replace") (cur[section] as Record<string, string>) = rec;
			else if (op === "merge" || op === "append") Object.assign(cur[section], rec);
			else if (op === "remove") for (const k of Object.keys(rec)) delete cur[section][k];
		} else {
			const list = Array.isArray(value) ? value.map(String) : [String(value)];
			if (op === "replace") (cur[section] as string[]) = list;
			else if (op === "append" || op === "merge") (cur[section] as string[]).push(...list);
			else (cur[section] as string[]) = (cur[section] as string[]).filter((x) => !list.includes(x));
		}
		return this.save(cur);
	}
}

export function conciseHarness(h: NfHarness): string {
	const lines = ["[项目 Harness · 精简]"];
	const env = Object.entries(h.环境).map(([k, v]) => `${k}=${v}`).join(", ");
	if (env) lines.push(`环境: ${env}`);
	const proj = Object.entries(h.项目).map(([k, v]) => `${k}=${v}`).join(", ");
	if (proj) lines.push(`项目: ${proj}`);
	if (h.验证命令.length) lines.push(`验证命令: ${h.验证命令.join(" | ")}`);
	if (h.调试任务.length) lines.push(`未解决调试任务: ${h.调试任务.join(" | ")}`);
	if (h.工作记忆.length) lines.push(`工作记忆: ${h.工作记忆.slice(0, 20).join(" | ")}`);
	return lines.length === 1 ? "" : lines.join("\n");
}

function normalize(input: Partial<NfHarness> | undefined): NfHarness {
	const s = input ?? {};
	return {
		schemaVersion: 1,
		环境: normalizeRecord(s.环境),
		项目: normalizeRecord(s.项目),
		验证命令: normalizeList(s.验证命令),
		调试工具: normalizeList(s.调试工具),
		调试任务: normalizeList(s.调试任务),
		工作记忆: normalizeList(s.工作记忆),
	};
}
function normalizeRecord(v: unknown): Record<string, string> {
	if (!v || typeof v !== "object" || Array.isArray(v)) return {};
	const out: Record<string, string> = {};
	for (const [k, raw] of Object.entries(v)) { const kk = k.trim(), vv = String(raw ?? "").trim(); if (kk && vv) out[kk] = vv.slice(0, 180); }
	return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
function normalizeList(v: unknown): string[] {
	const raw = Array.isArray(v) ? v : [];
	const seen = new Set<string>(); const out: string[] = [];
	for (const item of raw) { const t = String(item ?? "").replace(/\s+/g, " ").trim().slice(0, 220); if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
	return out.slice(0, 40);
}
function parseYaml(text: string): Partial<NfHarness> {
	const out: Partial<NfHarness> = {}; let section: string | undefined;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, "");
		if (!line.trim()) continue;
		const top = /^(schemaVersion|环境|项目|验证命令|调试工具|调试任务|工作记忆):\s*(.*)$/.exec(line);
		if (top && !rawLine.startsWith(" ")) {
			section = top[1];
			if (section === "环境" || section === "项目") (out[section] as Record<string, string>) = {};
			else if (section !== "schemaVersion") (out[section] as string[]) = [];
			continue;
		}
		if (!section || section === "schemaVersion") continue;
		if (section === "环境" || section === "项目") { const kv = /^\s+([^:]+):\s*(.*)$/.exec(rawLine); if (kv) (out[section] as Record<string, string>)[kv[1].trim()] = unquote(kv[2].trim()); }
		else { const item = /^\s*-\s*(.*)$/.exec(rawLine); if (item) (out[section] as string[]).push(unquote(item[1].trim())); }
	}
	return out;
}
function serializeYaml(h: NfHarness): string {
	const lines = ["schemaVersion: 1", "环境:"];
	for (const [k, v] of Object.entries(h.环境)) lines.push(`  ${k}: ${JSON.stringify(v)}`);
	lines.push("项目:");
	for (const [k, v] of Object.entries(h.项目)) lines.push(`  ${k}: ${JSON.stringify(v)}`);
	for (const s of ["验证命令", "调试工具", "调试任务", "工作记忆"] as const) { lines.push(`${s}:`); for (const i of h[s]) lines.push(`  - ${JSON.stringify(i)}`); }
	return `${lines.join("\n")}\n`;
}
function atomicWrite(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`; const fd = openSync(tmp, "w");
	try { writeFileSync(fd, text, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
	renameSync(tmp, path);
}
function unquote(v: string): string { if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } } return v; }
