import { readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const IGNORED_ROOTS = new Set([".git", ".xdd", ".pi", "node_modules", "vendor", "dist", "build", "coverage"]);
const BUSINESS_ID_DIRECTORY = /^b\d{2,}(?:[-_].*)?$/i;

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
