/**
 * Phase 4 (F.5): Controller-side init scaffold.
 *
 * Runs BEFORE the model sees the init stage prompt, so the model
 * doesn't need to use bash to create directories -- it just fills
 * in the intent.md skeleton. Extracted from run.ts so unit tests can
 * import it without pulling in extension.ts -> renderers.ts -> pi-tui
 * (which is not vitest-resolvable).
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function hasInitializedXddSkeleton(cwd: string): boolean {
	return existsSync(join(cwd, ".xdd", "design")) && existsSync(join(cwd, ".xdd", "runs"));
}

export function controllerInitScaffold(cwd: string): { created: string[]; skipped: string[] } {
	const dirs = [
		".xdd",
		".xdd/design",
		".xdd/design/spec",
		".xdd/design/architecture",
		".xdd/design/personas",
		".xdd/design/wire",
		".xdd/runs",
		".xdd/archive",
	];
	const created: string[] = [];
	const skipped: string[] = [];
	for (const d of dirs) {
		const abs = join(cwd, d);
		if (existsSync(abs)) {
			skipped.push(d);
		} else {
			mkdirSync(abs, { recursive: true });
			created.push(d);
		}
	}
	return { created, skipped };
}
