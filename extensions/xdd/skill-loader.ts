/**
 * Skill loader: discovers `xdd-*` skills from ALL standard locations and
 * populates `state.skills` so that `xdd_list_skills` / `xdd_load_skill` work.
 *
 * Scans three directories (dedup by name, first found wins):
 *   1. `<cwd>/skills/`         -- project root (xdd's own convention)
 *   2. `<cwd>/.pi/skills/`     -- pi project-local convention
 *   3. `~/.agents/skills/`     -- pi global/user convention
 *
 * This mirrors pi's built-in `loadSkills` discovery (which scans #2 and #3)
 * but also includes #1 so the xdd project's own `skills/` dir is covered.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";

/** Load xdd-* skills from all standard locations, deduplicated by name. */
export function loadXddSkills(cwd: string): Skill[] {
	const dirs = [
		join(cwd, "skills"), // project root (xdd convention)
		join(cwd, ".pi", "skills"), // pi project-local
		join(homedir(), ".agents", "skills"), // pi global/user
	];
	const seen = new Map<string, Skill>();
	for (const dir of dirs) {
		for (const skill of scanXddDir(dir)) {
			if (!seen.has(skill.name)) {
				seen.set(skill.name, skill);
			}
		}
	}
	return [...seen.values()];
}

/** Scan a single directory for `xdd-*` subdirectories containing SKILL.md. */
function scanXddDir(skillsDir: string): Skill[] {
	if (!existsSync(skillsDir)) return [];
	const skills: Skill[] = [];
	let entries: string[];
	try {
		entries = readdirSync(skillsDir, { withFileTypes: true })
			.filter((e) => e.isDirectory() && e.name.startsWith("xdd-"))
			.map((e) => e.name);
	} catch {
		return [];
	}
	for (const name of entries.sort()) {
		const baseDir = join(skillsDir, name);
		const skillMd = join(baseDir, "SKILL.md");
		if (!existsSync(skillMd)) continue;
		const content = readFileSync(skillMd, "utf8");
		const fm = parseFrontmatter(content);
		skills.push({
			name: fm.name ?? name,
			description: fm.description ?? "",
			filePath: skillMd,
			baseDir,
			sourceInfo: {
				path: skillMd,
				source: "xdd",
				scope: "project",
				origin: "top-level",
				baseDir,
			},
			disableModelInvocation: false,
		});
	}
	return skills;
}

/** Minimal YAML frontmatter parser: extracts `name` and `description` from `---\n...\n---`. */
function parseFrontmatter(content: string): { name?: string; description?: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const body = match[1];
	const nameMatch = body.match(/^name:\s*(.+)$/m);
	const name = nameMatch?.[1]?.trim();
	let description: string | undefined;
	const descBlockMatch = body.match(/^description:\s*\|?\s*\n([\s\S]*?)(?=\n[a-zA-Z]|\n---|$)/m);
	if (descBlockMatch) {
		description = descBlockMatch[1]
			.split("\n")
			.map((l) => l.replace(/^\s+/, ""))
			.join(" ")
			.trim();
	} else {
		const descInlineMatch = body.match(/^description:\s*(.+)$/m);
		description = descInlineMatch?.[1]?.trim();
	}
	return { name, description };
}
