/**
 * Phase 4 (F.5): Controller-side init scaffold.
 *
 * Runs BEFORE the model sees the init stage prompt, so the model
 * doesn't need to use bash to create directories -- it just fills
 * in the intent.md skeleton. Extracted from run.ts so unit tests can
 * import it without pulling in extension.ts -> renderers.ts -> pi-tui
 * (which is not vitest-resolvable).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scaffoldHooks } from "./hooks/scaffold.ts";

export function hasInitializedXddSkeleton(cwd: string): boolean {
	return existsSync(join(cwd, ".xdd", "design")) && existsSync(join(cwd, ".xdd", "runs"));
}

export const XDD_RUN_DIR = "xdd_run";
export const NORMAL_FLOW_RUN_DIR = "normal_run";

export function controllerInitScaffold(cwd: string, runDirName = XDD_RUN_DIR): { created: string[]; skipped: string[] } {
	const dirs = [
		".xdd",
		".xdd/design",
		".xdd/design/spec",
		".xdd/design/architecture",
		".xdd/design/personas",
		".xdd/design/wire",
		".xdd/runs",
		`.xdd/runs/${runDirName}`,
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
	// These are controller-owned structural markers, not product-design
	// placeholders. Init has no write tools, so its AIGate evidence must be
	// created deterministically before the model enters the stage.
	for (const [path, content] of Object.entries(SCAFFOLD_READMES)) {
		const abs = join(cwd, path);
		if (existsSync(abs)) {
			skipped.push(path);
		} else {
			writeFileSync(abs, content, "utf8");
			created.push(path);
		}
	}
	const hooks = scaffoldHooks(cwd);
	created.push(...hooks.created);
	skipped.push(...hooks.skipped);
	return { created, skipped };
}

const SCAFFOLD_READMES: Record<string, string> = {
	".xdd/design/README.md": `# Design workspace

Persistent product-design artifacts live here. The understand, spec, architecture, wire, and resilience stages create and refine their own documents; init deliberately does not invent product intent or acceptance criteria.
`,
	".xdd/runs/README.md": `# Run workspace

XDD stores the active run's goals, plan, audits, and verification evidence under xdd_run. Normal Flow uses normal_run so the two flows do not share run artifacts.
`,
	".xdd/archive/README.md": `# Archive workspace

Completed-run archives are stored here by the controller. This directory is intentionally empty until a run completes; archived records must remain attributable to their source run.
`,
};
