export const HARNESS_SCHEMA_VERSION = 1;

export type HarnessSection = "验证命令" | "调试工具" | "调试任务" | "工作记忆" | "项目" | "环境";
export type HarnessOperation = "replace" | "append" | "remove" | "merge";

export interface XddHarness {
	schemaVersion: 1;
	环境: Record<string, string>;
	项目: Record<string, string>;
	验证命令: string[];
	调试工具: string[];
	调试任务: string[];
	工作记忆: string[];
}

export const EMPTY_HARNESS: XddHarness = Object.freeze({
	schemaVersion: HARNESS_SCHEMA_VERSION,
	环境: {},
	项目: {},
	验证命令: [],
	调试工具: [],
	调试任务: [],
	工作记忆: [],
});

export function normalizeHarness(input: Partial<XddHarness> | undefined): XddHarness {
	const source = input ?? {};
	return {
		schemaVersion: HARNESS_SCHEMA_VERSION,
		环境: normalizeRecord(source.环境),
		项目: normalizeRecord(source.项目),
		验证命令: normalizeList(source.验证命令, 40, 220),
		调试工具: normalizeList(source.调试工具, 40, 120),
		调试任务: normalizeList(source.调试任务, 12, 180),
		工作记忆: normalizeList(source.工作记忆, 40, 180),
	};
}

export function conciseHarness(harness: XddHarness): string {
	const lines: string[] = ["[项目 Harness · 精简]"];
	const env = formatRecord(harness.环境);
	const project = formatRecord(harness.项目);
	if (env) lines.push(`环境: ${env}`);
	if (project) lines.push(`项目: ${project}`);
	if (harness.验证命令.length) lines.push(`验证命令: ${harness.验证命令.join(" | ")}`);
	if (harness.调试任务.length) lines.push(`未解决调试任务: ${harness.调试任务.join(" | ")}`);
	if (harness.工作记忆.length) lines.push(`工作记忆: ${harness.工作记忆.slice(0, 20).join(" | ")}`);
	return lines.length === 1 ? "" : lines.join("\n");
}

function normalizeRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value)) {
		const k = key.trim();
		const v = String(raw ?? "").trim();
		if (k && v) out[k] = v.slice(0, 180);
	}
	return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeList(value: unknown, maxItems: number, maxChars: number): string[] {
	const raw = Array.isArray(value) ? value : [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of raw) {
		const text = String(item ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars);
		if (!text || seen.has(text)) continue;
		seen.add(text);
		out.push(text);
		if (out.length >= maxItems) break;
	}
	return out;
}

function formatRecord(record: Record<string, string>): string {
	return Object.entries(record).map(([key, value]) => `${key}=${value}`).join(", ");
}
