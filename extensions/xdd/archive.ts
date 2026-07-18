/**
 * xdd run archive: 归档 runs/<run>/ 的产物（避免 runs/ 越积越多），
 * design/ 是项目设计，永不删。
 *
 * 设计原则（用户指定）：
 *   - 归档的对象是 `<runs/<run>/>` （单个 run 的产物：goals/plan/verify-report 等）
 *   - design/ 是项目的设计，永远不删
 *   - 归档 = 总结 + 删原本，不是搬到归档目录
 *   - 归档路径：写到 .xdd/archive/<run>.md （持久，runs/ 被删也不丢）
 *
 * runs/<run>/ 下所有文件读全；design/ 下只读，不删；写摘要到 archive.md；最后删 runs/<run>/
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface ArchiveResult {
	archivedAt: string;
	archivePath: string;
	sourceRunsDir: string;
	deletedPaths: string[];
	keptPaths: string[]; // design/ files that were READ for the summary (not modified)
}

/**
 * Archive a completed run (runs/<run>/) by summarizing it into .xdd/archive/<run>.md
 * and deleting the original runs/<run>/. NEVER touches design/.
 *
 * @param cwd         repo root (where .xdd/ lives)
 * @param runLabel   the run dir name (e.g., "xdd_run", "normal_run"). Empty = pick most recently modified runs subdir
 */
export function archiveRun(cwd: string, runLabel?: string): ArchiveResult {
	const runsDir = join(cwd, ".xdd/runs");
	const designDir = join(cwd, ".xdd/design");
	const archiveDir = join(cwd, ".xdd/archive");
	mkdirSync(archiveDir, { recursive: true });

	// Resolve target runs dir
	let sourceRunsDir: string;
	if (runLabel) {
		sourceRunsDir = join(runsDir, runLabel);
	} else {
		// pick the most recently modified runs/*/ subdirectory
		sourceRunsDir = pickMostRecentRunsDir(runsDir);
	}

	if (!existsSync(sourceRunsDir)) {
		throw new Error(`runs 目录不存在: ${sourceRunsDir}`);
	}

	// Build archive.md content
	const sections: string[] = [];
	sections.push(`# xdd Run Archive -- ${basename(sourceRunsDir)}`);
	sections.push(`> Generated ${new Date().toISOString()} from ${sourceRunsDir}/.`);
	sections.push(`> runs/*/ 删除归档，避免污染。design/* 仅读取（项目设计永久保留）。`);
	sections.push("");

	// -- 1. Reads from runs/<run>/ (full read, will be deleted after) --
	const runsFiles = listFilesRecursive(sourceRunsDir);
	const designReadFiles: string[] = []; // 设计文件被读取，但不修改，记录在 summary 里

	const sectionsRuns = collectRunsSummary(sourceRunsDir, runsDir);
	if (sectionsRuns) {
		sections.push("## Run Records (runs/ 内容)");
		sections.push(sectionsRuns);
		sections.push("");
	}

	// -- 2. Reads from design/ (READ-ONLY summary) --
	if (existsSync(designDir)) {
		const intent = readIfExists(join(designDir, "intent.md"));
		if (intent) {
			sections.push("## Intent (design/intent.md)");
			sections.push(intent);
			sections.push("");
			designReadFiles.push(join(designDir, "intent.md"));
		}
		const design = readIfExists(join(designDir, "design.md"));
		if (design) {
			sections.push("## Design Decisions (design/design.md)");
			sections.push(extractSections(design, ["Selected", "Alternatives", "Assumptions", "Out of Scope", "Open Questions"]));
			sections.push("");
			designReadFiles.push(join(designDir, "design.md"));
		}
		// spec/ -- RXX rules per BXX (captures the rules; deletes per "deletes verbose")
		if (existsSync(join(designDir, "spec"))) {
			const bxxDirs = readdirSync(join(designDir, "spec")).filter((d) => d.startsWith("B"));
			if (bxxDirs.length > 0) {
				sections.push("## Features (RXX rules per business line)");
				for (const bxx of bxxDirs.sort()) {
					const bxxPath = join(designDir, "spec", bxx);
					const rules = readIfExists(join(bxxPath, "rules.md"));
					if (rules) {
						sections.push(`### ${bxx}`);
						sections.push(rules);
						// Summarize .feature to scenario count
						const features = existsSync(bxxPath) ? readdirSync(bxxPath).filter((f) => f.endsWith(".feature")) : [];
						if (features.length > 0) {
							let totalScenarios = 0, totalExceptionScenarios = 0;
							for (const f of features) {
								const c = readFileSync(join(bxxPath, f), "utf8");
								const scenarios = (c.match(/\bScenario\b/g) || []).length;
								const ex = (c.match(/拒绝|失败|不存在|无权限|冲突/g) || []).length;
								totalScenarios += scenarios;
								totalExceptionScenarios += Math.min(ex, scenarios);
							}
							sections.push(`> ${features.length} Feature files, ${totalScenarios} Scenarios (${totalExceptionScenarios} exception paths)`);
						}
						sections.push("");
					}
				}
				designReadFiles.push(join(designDir, "spec"));
			}
		}
		// architecture/ -- per-BXX summary
		if (existsSync(join(designDir, "architecture"))) {
			sections.push("## Architecture (design/architecture/ 内容)");
			const archEntries = readdirSync(join(designDir, "architecture"));
			for (const f of archEntries) {
				const full = join(designDir, "architecture", f);
				if (statSync(full).isFile() && f.endsWith(".md")) {
					const content = readIfExists(full);
					if (content) {
						sections.push(`### ${basename(f, ".md")}`);
						sections.push(content.trim());
						sections.push("");
					}
				}
			}
			designReadFiles.push(join(designDir, "architecture"));
		}
	}

	// Write archive.md
	const archiveFileName = `${basename(sourceRunsDir)}.md`;
	const archivePath = join(archiveDir, archiveFileName);
	writeFileSync(archivePath, sections.join("\n"), "utf8");

	// Delete the runs/<run>/ directory (the whole run record)
	const deletedPaths: string[] = [];
	function recurseDelete(dir: string) {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				recurseDelete(full);
				rmSync(full, { force: true });
			} else {
				rmSync(full, { force: true });
			}
			deletedPaths.push(full);
		}
	}
	recurseDelete(sourceRunsDir);
	// Remove the empty source dir
	rmSync(sourceRunsDir, { recursive: true, force: true });

	return {
		archivedAt: new Date().toISOString(),
		archivePath,
		sourceRunsDir,
		deletedPaths,
		keptPaths: designReadFiles, // NOTE: design/ is KEPT (NEVER modified). These files were only READ for the summary.
	};
}

function listFilesRecursive(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listFilesRecursive(full));
		else out.push(full);
	}
	return out;
}

function readIfExists(path: string): string | null {
	return existsSync(path) ? readFileSync(path, "utf8").trim() : null;
}

function pickMostRecentRunsDir(runsDir: string): string {
	if (!existsSync(runsDir)) {
		throw new Error(`runs 目录不存在: ${runsDir}`);
	}
	const all = readdirSync(runsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
	if (all.length === 0) {
		throw new Error(`runs 目录 ${runsDir} 下没有任何 run 子目录`);
	}
	all.sort((a, b) => statSync(join(runsDir, b.name)).mtimeMs - statSync(join(runsDir, a.name)).mtimeMs);
	return join(runsDir, all[0].name);
}

/** Summarize all files under runs/<run>/ for the archive. */
function collectRunsSummary(runsDir: string, fullRunsDir: string): string | null {
	const files = listFilesRecursive(runsDir);
	if (files.length === 0) return null;
	const lines: string[] = [];
	for (const f of files.sort()) {
		const rel = f.slice(fullRunsDir.length + 1);
		const size = statSync(f).size;
		lines.push(`- \`${rel}\` (${size}B)`);
	}
	return "Files:\n" + lines.join("\n");
}

/** Extract only the listed sections from a markdown file. Normalizes heading levels. */
function extractSections(md: string, headings: string[]): string {
	const lines = md.split("\n");
	const matched: string[] = [];
	let currentSection: string | null = null;
	let currentLines: string[] = [];
	const inTarget = (h: string) => headings.some((t) => h.includes(t));
	const flush = () => {
		if (currentSection && inTarget(currentSection)) {
			matched.push(`### ${currentSection}`);
			for (const l of currentLines) {
				matched.push(l.startsWith("## ") ? l.replace(/^## /, "### ") : l);
			}
		}
	};
	for (const line of lines) {
		const h = line.match(/^#\s+(.+)/);
		if (h) {
			flush();
			currentSection = h[1].trim();
			currentLines = [];
		} else if (currentSection) {
			currentLines.push(line);
		}
	}
	flush();
	return matched.length > 0 ? matched.join("\n").trim() : md.trim();
}
