/** NF 自包含文件系统观测 + RXX 追溯覆盖。 */
import { existsSync, readdirSync, readFileSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";
import { globToRegExp, hasGlobMeta, walkRel } from "./gate.ts";

export interface NfFsSnapshot {
	deliverables: Array<{ path: string; exists: boolean; bytes: number }>;
	implementsCount: number;
	implementsRxx: string[];
	specRxx: string[];
	featureFiles: number;
}

const CODE_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "target", "venv", "__pycache__", ".venv", ".xdd", "regression"]);
const IMPLEMENTS_RE = /@implements\s+((?:B\d{2}-)?R\d{2})/g;
const RULES_RXX_RE = /\|\s*(?:B\d{2}-)?R\d{2}\b/g;
const SOURCE_EXT_RE = /\.(?:t|j)sx?$|\.py$|\.go$|\.rs$|\.java$|\.rb$|\.php$|\.kt$|\.cs$|\.vue$|\.svelte$/;

function safeStat(path: string): Stats | undefined { try { return statSync(path); } catch { return undefined; } }

function walkSourceFiles(cwd: string, maxFiles = 4000): string[] {
	const out: string[] = []; const stack: string[] = [cwd]; let count = 0;
	while (stack.length > 0 && count < maxFiles) {
		const current = stack.pop() as string;
		let entries: string[]; try { entries = readdirSync(current); } catch { continue; }
		for (const name of entries) {
			const full = join(current, name); const st = safeStat(full); if (!st) continue; count++;
			if (st.isDirectory()) { if (!CODE_SKIP_DIRS.has(name)) stack.push(full); } else out.push(full);
		}
	}
	return out;
}

function scanImplements(cwd: string): { count: number; rxx: string[] } {
	if (!existsSync(cwd)) return { count: 0, rxx: [] };
	const ids = new Set<string>(); let total = 0;
	for (const file of walkSourceFiles(cwd)) {
		if (!SOURCE_EXT_RE.test(file)) continue;
		let content: string; try { content = readFileSync(file, "utf8"); } catch { continue; }
		let m: RegExpExecArray | null; IMPLEMENTS_RE.lastIndex = 0;
		while ((m = IMPLEMENTS_RE.exec(content)) !== null) { total++; ids.add(m[1]); }
	}
	return { count: total, rxx: [...ids].sort() };
}

function scanSpec(specDir: string): { rxx: string[]; features: number } {
	if (!existsSync(specDir)) return { rxx: [], features: 0 };
	const rxx = new Set<string>(); let features = 0;
	const stack: string[] = [specDir];
	while (stack.length > 0) {
		const current = stack.pop() as string;
		let entries: string[]; try { entries = readdirSync(current); } catch { continue; }
		for (const name of entries) {
			const full = join(current, name); const st = safeStat(full); if (!st) continue;
			if (st.isDirectory()) stack.push(full);
			else if (name === "rules.md") {
				try {
					const content = readFileSync(full, "utf8");
					const bxxMatch = full.match(/[\\/]spec[\\/](B\d{2})-/i);
					const bxxPrefix = bxxMatch?.[1]?.toUpperCase();
					for (const m of content.matchAll(RULES_RXX_RE)) {
						let id = m[0].slice(1).trim();
						if (!id) continue;
						if (bxxPrefix && /^R\d{2}$/.test(id)) id = `${bxxPrefix}-${id}`;
						rxx.add(id);
					}
				} catch { /* ignore */ }
			} else if (name.endsWith(".feature")) features++;
		}
	}
	return { rxx: [...rxx].sort(), features };
}

export function observeFilesystem(cwd: string, deliverablePaths: readonly string[]): NfFsSnapshot {
	const hasGlob = deliverablePaths.some((p) => hasGlobMeta(p));
	const walked = hasGlob ? walkRel(cwd) : undefined;
	const deliverables = deliverablePaths.map((p) => {
		if (hasGlobMeta(p) && walked) {
			const reg = globToRegExp(p);
			const match = walked.find((f) => reg.test(f.replace(/\\/g, "/")));
			if (!match) return { path: p, exists: false, bytes: 0 };
			const st = safeStat(join(cwd, match));
			return { path: p, exists: !!st && st.isFile(), bytes: st?.size ?? 0 };
		}
		const st = safeStat(join(cwd, p));
		return { path: p, exists: !!st && st.isFile(), bytes: st?.size ?? 0 };
	});
	const { rxx: specRxx, features: featureFiles } = scanSpec(join(cwd, ".xdd", "design", "spec"));
	const impls = scanImplements(cwd);
	return { deliverables, implementsCount: impls.count, implementsRxx: impls.rxx, specRxx, featureFiles };
}

export function renderFsSnapshot(snap: NfFsSnapshot): string {
	const lines = ["文件系统观测 (真实工程状态):"];
	if (snap.deliverables.length > 0) {
		lines.push("阶段产物:", ...snap.deliverables.map((d) => `  ${d.exists ? "[有]" : "[无]"} ${d.path}${d.exists ? ` (${d.bytes}B)` : ""}`));
	}
	lines.push(`代码 @implements RXX: ${snap.implementsCount} 处${snap.implementsRxx.length > 0 ? ` (${snap.implementsRxx.join(", ")})` : ""}`);
	if (snap.specRxx.length > 0 || snap.featureFiles > 0) lines.push(`.xdd spec: ${snap.specRxx.length} 条 RXX, ${snap.featureFiles} 个 feature`);
	return lines.join("\n");
}

export interface NfTraceCoverage {
	specRxx: string[];
	implementedRxx: string[];
	unimplemented: string[];
	orphan: string[];
	featureFiles: number;
}

export function buildTraceCoverage(snap: NfFsSnapshot): NfTraceCoverage {
	const specSet = new Set(snap.specRxx);
	const implSet = new Set(snap.implementsRxx);
	return {
		specRxx: snap.specRxx,
		implementedRxx: snap.implementsRxx,
		unimplemented: snap.specRxx.filter((r) => !implSet.has(r)),
		orphan: snap.implementsRxx.filter((r) => !specSet.has(r)),
		featureFiles: snap.featureFiles,
	};
}
