import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_MAX_TOTAL_CHARS = 200_000;
const DEFAULT_MAX_FILE_CHARS = 50_000;
const MAX_DIRECTORY_CHARS = 200_000;
const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", "target", ".next", ".cache"]);
const DESIGN_ROOT = ".xdd/design";
const DESIGN_BATCHES = ["design.md", "intent.md", "spec/", "architecture/", "wire/", "architecture/*/resilience/"];

export interface ReadDirParams {
	paths: string[];
	maxTotalChars?: number;
	maxFileChars?: number;
}

function inside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function requestsWholeDesign(root: string, paths: readonly string[]): boolean {
	let designRoot: string;
	try { designRoot = realpathSync(resolve(root, DESIGN_ROOT)); } catch { return false; }
	return paths.some((path) => {
		let requested: string;
		try { requested = realpathSync(resolve(root, path)); } catch { requested = resolve(root, path); }
		return requested === designRoot || inside(requested, designRoot);
	});
}

function collect(root: string, requested: readonly string[]): { files: string[]; rejected: string[]; missing: string[] } {
	const files = new Set<string>();
	const rejected: string[] = [];
	const missing: string[] = [];
	const visit = (candidate: string): void => {
		let real: string;
		try { real = realpathSync(candidate); } catch { missing.push(relative(root, candidate) || candidate); return; }
		if (!inside(root, real)) { rejected.push(relative(root, candidate) || candidate); return; }
		const stat = statSync(real);
		if (stat.isFile()) { files.add(real); return; }
		if (!stat.isDirectory()) return;
		for (const entry of readdirSync(real, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
			visit(resolve(real, entry.name));
		}
	};
	for (const path of requested) visit(resolve(root, path));
	return { files: [...files].sort(), rejected, missing };
}

function assertDirectorySizes(root: string, requested: readonly string[], files: readonly string[]): void {
	for (const requestedPath of requested) {
		let directory: string;
		try {
			directory = realpathSync(resolve(root, requestedPath));
			if (!inside(root, directory) || !statSync(directory).isDirectory()) continue;
		} catch { continue; }

		let chars = 0;
		for (const file of files) {
			if (!inside(directory, file)) continue;
			let content: string;
			try { content = readFileSync(file, "utf8"); } catch { continue; }
			if (content.includes("\0")) continue;
			chars += content.length;
			if (chars > MAX_DIRECTORY_CHARS) {
				const path = relative(root, directory).replace(/\\/g, "/") || ".";
				throw new Error(
					`[read_dir] 目录 ${path}/ 超过 ${MAX_DIRECTORY_CHARS} 字符，禁止一次读取；请读取更小单位目录。`,
				);
			}
		}
	}
}

export function readDir(cwd: string, params: ReadDirParams) {
	if (!params.paths.length) throw new Error("[read_dir] paths 至少需要一个文件或目录");
	const maxTotal = params.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
	const maxFile = params.maxFileChars ?? DEFAULT_MAX_FILE_CHARS;
	if (maxTotal < 1 || maxFile < 1) throw new Error("[read_dir] 字符上限必须大于 0");
	const root = realpathSync(cwd);
	if (requestsWholeDesign(root, params.paths)) {
		throw new Error(
			`[read_dir] ${DESIGN_ROOT}/ 可能包含大量设计契约，禁止整目录一次读取。请按阶段分批读取：${DESIGN_BATCHES.join("、")}`,
		);
	}
	const { files, rejected, missing } = collect(root, params.paths);
	assertDirectorySizes(root, params.paths, files);
	const sections: string[] = [];
	const truncated: string[] = [];
	const skipped: string[] = [];
	let used = 0;
	for (const file of files) {
		const path = relative(root, file).replace(/\\/g, "/");
		let content: string;
		try { content = readFileSync(file, "utf8"); } catch { skipped.push(path); continue; }
		if (content.includes("\0")) { skipped.push(path); continue; }
		if (content.length > maxFile) { content = `${content.slice(0, maxFile)}\n… [单文件已截断]`; truncated.push(path); }
		const header = `===== ${path} =====\n`;
		const remaining = maxTotal - used - header.length;
		if (remaining <= 0) { skipped.push(path); continue; }
		if (content.length > remaining) {
			const marker = "\n… [总量已截断]";
			content = remaining <= marker.length ? marker.slice(0, remaining) : content.slice(0, remaining - marker.length) + marker;
			truncated.push(path);
		}
		sections.push(header + content);
		used += header.length + content.length;
		if (used >= maxTotal) skipped.push(...files.slice(files.indexOf(file) + 1).map((item) => relative(root, item).replace(/\\/g, "/")));
		if (used >= maxTotal) break;
	}
	const summary = `[read_dir] 一次读取 ${sections.length}/${files.length} 个文件，共 ${used} 字符`;
	const warnings = [
		truncated.length ? `截断: ${[...new Set(truncated)].join(", ")}` : "",
		skipped.length ? `跳过（二进制/不可读/超出总量）: ${[...new Set(skipped)].join(", ")}` : "",
		rejected.length ? `拒绝（项目外路径）: ${rejected.join(", ")}` : "",
		missing.length ? `不存在: ${missing.join(", ")}` : "",
	].filter(Boolean);
	return { text: [summary, ...warnings, "", ...sections].join("\n"), details: { files: sections.length, discovered: files.length, chars: used, truncated, skipped, rejected, missing } };
}

export default function readDirExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "read_dir",
		label: "Read Dir",
		description: "一次批量读取多个文件或目录（目录会递归），合并为一个结果，避免逐个调用 read。目录文本总量超过 200000 字符时拒绝读取，必须改读更小单位目录。自动排除依赖/构建目录、项目外链接和二进制文件，并以字符上限兜底。.xdd/design 禁止整目录读取，必须按 design.md、spec、architecture、wire、resilience 等分批读取。",
		parameters: {
			type: "object", properties: {
				paths: { type: "array", minItems: 1, items: { type: "string" }, description: "相对当前项目的文件或目录列表，如 [\".xdd/design/spec\"]" },
				maxTotalChars: { type: "integer", minimum: 1, description: `总字符上限，默认 ${DEFAULT_MAX_TOTAL_CHARS}` },
				maxFileChars: { type: "integer", minimum: 1, description: `单文件字符上限，默认 ${DEFAULT_MAX_FILE_CHARS}` },
			}, required: ["paths"], additionalProperties: false,
		},
		async execute(_id, params: ReadDirParams, _update, ctx) {
			const result = readDir(String(ctx?.cwd ?? process.cwd()), params);
			return { content: [{ type: "text" as const, text: result.text }], details: result.details };
		},
	});
}
