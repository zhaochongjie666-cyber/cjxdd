import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const IGNORED_ROOTS = new Set([".git", ".xdd", ".pi", "node_modules", "vendor", "dist", "build", "coverage"]);
const BUSINESS_ID_DIRECTORY = /^b\d{2,}(?:[-_].*)?$/i;
const SOURCE_DIAGNOSTIC_LIMIT = 20;
const SOURCE_STATUS_EXCLUDES = [
	"node_modules", "vendor", "dist", "build", "coverage", ".next", "target", ".cache",
].flatMap((directory) => [`:(exclude)${directory}/**`, `:(glob,exclude)**/${directory}/**`]);

export function isReviewableProductionSource(path: string): boolean {
	const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
	if (normalized.startsWith(".xdd/") || /(^|\/)(?:node_modules|vendor|dist|build|coverage|\.next|target|\.cache)(\/|$)/i.test(normalized)) return false;
	if (/(^|\/)(?:tests?|docs?|fixtures?)(\/|$)/i.test(normalized)) return false;
	return /(^|\/)(?:src|lib|app|server|client|cmd|internal|pkg)(\/|$)/i.test(normalized)
		|| /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|cs|rb|php|swift|vue|svelte)$/i.test(normalized);
}

/** Read only reviewable working-tree sources; pathspec exclusions keep dependency trees out of git's output too. */
export function changedProductionSources(cwd: string): string[] {
	return execFileSync("git", [
		"status", "--porcelain=v1", "--untracked-files=all", "--", ".", ...SOURCE_STATUS_EXCLUDES,
	], { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })
		.split("\n").filter(Boolean)
		.map((line) => line.slice(3).split(" -> ").at(-1) ?? "")
		.filter(isReviewableProductionSource);
}

/** Bound agent-facing errors so a dependency tree can never consume the context window. */
export function formatMissingProductionSources(paths: readonly string[], limit = SOURCE_DIAGNOSTIC_LIMIT): string {
	const visible = paths.slice(0, Math.max(1, limit));
	const remaining = paths.length - visible.length;
	return `${visible.join(", ")}${remaining > 0 ? `，另有 ${remaining} 个未显示（总计 ${paths.length} 个）` : ""}`;
}

/**
 * BXX is a design traceability identifier, not a production module name.
 * It is valid below .xdd, but must never determine the source tree shape.
 */
export function findBusinessIdCodeDirectories(cwd: string): string[] {
	const root = resolve(cwd);
	const violations: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
			const path = resolve(directory, entry.name);
			const rel = relative(root, path).split(sep).join("/");
			if (!rel.includes("/") && IGNORED_ROOTS.has(entry.name)) continue;
			if (BUSINESS_ID_DIRECTORY.test(entry.name)) {
				violations.push(rel);
				continue;
			}
			visit(path);
		}
	};
	visit(root);
	return violations.sort();
}

export function evaluateProductionPathPolicy(cwd: string): { ok: true } | { ok: false; reason: string } {
	const violations = findBusinessIdCodeDirectories(cwd);
	if (violations.length === 0) return { ok: true };
	return {
		ok: false,
		reason: `execute Gate: BXX 是 .xdd 设计文档中的业务线编号，不能作为代码目录名：${violations.join(", ")}。请按领域能力命名（如 auth-service、project-service），BXX/RXX 只保留在设计路径、追踪表和 @implements 标注中。`,
	};
}
