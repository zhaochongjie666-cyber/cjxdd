import { existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { matchesGlob } from "../glob-resolver.ts";
import type { XddStageSpec } from "../types.ts";

export type PathAccessKind = "read" | "write";

export interface PathPolicyResult {
	ok: boolean;
	path: string;
	relativePath?: string;
	reason?: string;
	allowedScopes?: readonly string[];
}

const PROTECTED_WRITE_PREFIXES = [".git", ".pi", ".agents", "node_modules"];

export function normalizeWorkspacePath(cwd: string, inputPath: string): PathPolicyResult {
	const raw = inputPath.trim() || ".";
	const resolved = resolve(cwd, raw);
	const canonical = canonicalizeWithExistingParent(resolved);
	const cwdReal = realpathSync(cwd);
	const rel = relative(cwdReal, canonical).split(sep).join("/");
	if (rel === "") return { ok: true, path: canonical, relativePath: "." };
	if (rel.startsWith("..") || rel === "..") {
		return { ok: false, path: canonical, reason: `路径逃逸 cwd: ${inputPath}` };
	}
	return { ok: true, path: canonical, relativePath: rel };
}

export function checkStagePathAccess(cwd: string, stage: XddStageSpec, inputPath: string, kind: PathAccessKind): PathPolicyResult {
	const normalized = normalizeWorkspacePath(cwd, inputPath);
	if (!normalized.ok || !normalized.relativePath) return normalized;
	const rel = normalized.relativePath === "." ? "" : normalized.relativePath;
	if (kind === "write" && isProtectedWrite(rel)) {
		return { ...normalized, ok: false, reason: `禁止写入受保护路径: ${normalized.relativePath}` };
	}
	const scopes = kind === "read" ? stage.readScopes ?? [] : stage.writeScopes ?? [];
	if (!isCoveredByScopes(rel, scopes)) {
		return {
			...normalized,
			ok: false,
			reason: `${stage.name} 阶段不允许 ${kind === "read" ? "读取" : "写入"}: ${normalized.relativePath}`,
			allowedScopes: scopes,
		};
	}
	return normalized;
}

export function isCoveredByScopes(relativePath: string, scopes: readonly string[]): boolean {
	const rel = relativePath || ".";
	return scopes.some((scope) => scope === "**" || matchesGlob(scope, rel) || matchesGlob(scope, `${rel}/`) || matchesGlob(`${scope.replace(/\/$/, "")}/**`, rel));
}

function isProtectedWrite(relativePath: string): boolean {
	return PROTECTED_WRITE_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

function canonicalizeWithExistingParent(path: string): string {
	if (existsSync(path)) return realpathSync(path);
	let parent = dirname(path);
	const missing: string[] = [];
	while (!existsSync(parent) && parent !== dirname(parent)) {
		missing.unshift(parent.split(sep).at(-1) ?? "");
		parent = dirname(parent);
	}
	const parentReal = existsSync(parent) ? realpathSync(parent) : parent;
	const leaf = path.slice(parent.length).replace(/^[\/]+/, "");
	return resolve(parentReal, ...missing, leaf);
}
