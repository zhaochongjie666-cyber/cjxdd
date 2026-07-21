import { existsSync, readdirSync, readFileSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";
import { globToRegExp, hasGlobMeta, walkRel } from "./gate.ts";
import { RuntimeStore } from "./storage/runtime-store.ts";

/**
 * Filesystem observation for the Controller cycle (core.md: observation = observe()).
 *
 * The runner's in-memory bookkeeping (XddRunnerState) only knows what the model
 * self-reported via xdd_submit_artifact. That is not the real engineering state.
 * This module reads the disk: deliverable files, checkpoint presence, code-level
 * @implements RXX markers, and the .xdd/ design-layer artifacts. It is the
 * truth source behind core.md principle 1 (State is the single source of truth)
 * and principle 3 (Gate decides advancement, not self-declaration).
 *
 * All scans are best-effort and degrade to empty when a layout is absent, so
 * the same tool works for both the extension's docs/ layout and the framework's
 * .xdd/ layout.
 */

export interface XddDeliverableStatus {
	path: string;
	exists: boolean;
	bytes: number;
}

export interface XddPlanTaskCounts {
	pending: number;
	inProgress: number;
	done: number;
	blocked: number;
	total: number;
}

export interface XddFsSnapshot {
	/** Per-deliverable-path existence + size (the gate's own target files). */
	deliverables: XddDeliverableStatus[];
	/** True when <cwd>/.xdd/checkpoint.json exists (resume is possible). */
	checkpointExists: boolean;
	/** Count of @implements RXX markers found in source code. */
	implementsCount: number;
	/** RXX ids found as @implements markers in code (for trace-chain coverage). */
	implementsRxx: string[];
	/** RXX ids discovered in .xdd design spec rules.md tables. */
	specRxx: string[];
	/** Number of .feature files under .xdd/design/spec/. */
	featureFiles: number;
	/** Plan task checkbox counts parsed from plan.md under .xdd/runs. */
	planTasks: XddPlanTaskCounts;
	activeHealing?: { id: string; failureCode: string; targetStage: string; status: string; generation: number; receiptFresh: boolean; closureCriteria: string[] };
}

const EMPTY_PLAN_TASKS: XddPlanTaskCounts = {
	pending: 0,
	inProgress: 0,
	done: 0,
	blocked: 0,
	total: 0,
};

/** Directories never walked when scanning for @implements markers in code. */
const CODE_SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".next",
	"target",
	"venv",
	"__pycache__",
	".venv",
	".xdd",
	"regression",
]);

/** Match @implements R01 / @implements B01-R01 / @implements RXX style markers. */
const IMPLEMENTS_RE = /@implements\s+((?:B\d{2}-)?R\d{2})/g;
/** Match RXX id tokens inside spec rules.md table rows, e.g. | R01 | or | B01-R01 |. */
const RULES_RXX_RE = /\|\s*(?:B\d{2}-)?R\d{2}\b/g;

function safeStat(path: string): Stats | undefined {
	try {
		return statSync(path);
	} catch {
		return undefined;
	}
}

/**
 * Walk source files under `cwd`, skipping heavy/non-source dirs. Returns file
 * paths (absolute). Capped to avoid pathological repos.
 */
function walkSourceFiles(cwd: string, maxFiles = 4000): string[] {
	const out: string[] = [];
	const stack: string[] = [cwd];
	let count = 0;
	while (stack.length > 0 && count < maxFiles) {
		const current = stack.pop() as string;
		let entries: string[];
		try {
			entries = readdirSync(current);
		} catch {
			continue;
		}
		for (const name of entries) {
			const full = join(current, name);
			const st = safeStat(full);
			if (!st) continue;
			count++;
			if (st.isDirectory()) {
				if (!CODE_SKIP_DIRS.has(name)) stack.push(full);
			} else {
				out.push(full);
			}
		}
	}
	return out;
}

const SOURCE_EXT_RE = /\.(t|j)sx?$|\.py$|\.go$|\.rs$|\.java$|\.rb$|\.php$|\.kt$|\.cs$|\.vue$|\.svelte$/;

/** Collect @implements RXX ids across source files. */
function scanImplements(cwd: string): { count: number; rxx: string[] } {
	if (!existsSync(cwd)) return { count: 0, rxx: [] };
	const ids = new Set<string>();
	let total = 0;
	for (const file of walkSourceFiles(cwd)) {
		if (!SOURCE_EXT_RE.test(file)) continue;
		let content: string;
		try {
			content = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		let m: RegExpExecArray | null;
		IMPLEMENTS_RE.lastIndex = 0;
		while ((m = IMPLEMENTS_RE.exec(content)) !== null) {
			total++;
			ids.add(m[1]);
		}
	}
	return { count: total, rxx: [...ids].sort() };
}

/** Collect RXX ids + feature file count under .xdd/design/spec/. */
function scanXddSpec(specDir: string): { rxx: string[]; features: number } {
	if (!existsSync(specDir)) return { rxx: [], features: 0 };
	const rxx = new Set<string>();
	let features = 0;
	const stack: string[] = [specDir];
	while (stack.length > 0) {
		const current = stack.pop() as string;
		let entries: string[];
		try {
			entries = readdirSync(current);
		} catch {
			continue;
		}
		for (const name of entries) {
			const full = join(current, name);
			const st = safeStat(full);
			if (!st) continue;
			if (st.isDirectory()) {
				stack.push(full);
			} else if (name === "rules.md") {
				try {
					const content = readFileSync(full, "utf8");
					for (const m of content.matchAll(RULES_RXX_RE)) {
						const id = m[0].slice(1).trim();
						if (id) rxx.add(id);
					}
				} catch {
					// ignore unreadable rules.md
				}
			} else if (name.endsWith(".feature")) {
				features++;
			}
		}
	}
	return { rxx: [...rxx].sort(), features };
}

/** Parse plan task checkbox counts from a plan.md body. */
function parsePlanTaskCounts(content: string): XddPlanTaskCounts {
	const counts = { pending: 0, inProgress: 0, done: 0, blocked: 0, total: 0 };
	for (const line of content.split("\n")) {
		const m = line.match(/^\s*[-*]\s+\[([ x~!])\]/i);
		if (!m) continue;
		counts.total++;
		const mark = m[1].toLowerCase();
		if (mark === "x") counts.done++;
		else if (mark === "~") counts.inProgress++;
		else if (mark === "!") counts.blocked++;
		else counts.pending++;
	}
	return counts;
}

/** Find xdd_run plan.md files under .xdd/runs/ and sum task counts. */
function scanXddPlan(cwd: string): XddPlanTaskCounts {
	const runsDir = join(cwd, ".xdd", "runs");
	if (!existsSync(runsDir)) return EMPTY_PLAN_TASKS;
	const planFiles: string[] = [];
	const searchRoots = [join(runsDir, "xdd_run")];
	const stack = [...searchRoots];
	while (stack.length > 0) {
		const current = stack.pop() as string;
		let entries: string[];
		try {
			entries = readdirSync(current);
		} catch {
			continue;
		}
		for (const name of entries) {
			const full = join(current, name);
			const st = safeStat(full);
			if (!st) continue;
			if (st.isDirectory()) {
				stack.push(full);
			} else if (name === "plan.md") {
				planFiles.push(full);
			}
		}
	}

	if (planFiles.length === 0) return EMPTY_PLAN_TASKS;
	const summed = { pending: 0, inProgress: 0, done: 0, blocked: 0, total: 0 };
	for (const file of planFiles) {
		try {
			const content = readFileSync(file, "utf8");
			const partial = parsePlanTaskCounts(content);
			summed.pending += partial.pending;
			summed.inProgress += partial.inProgress;
			summed.done += partial.done;
			summed.blocked += partial.blocked;
			summed.total += partial.total;
		} catch {
			// ignore unreadable plan.md
		}
	}
	return summed;
}

/**
 * Build the filesystem snapshot for the current stage. `deliverablePaths` come
 * from the active XddStageSpec (the same paths the hard gate checks).
 */
export function observeFilesystem(cwd: string, deliverablePaths: readonly string[]): XddFsSnapshot {
	const hasGlob = deliverablePaths.some((p) => hasGlobMeta(p));
	const walked = hasGlob ? walkRel(cwd) : undefined;
	const deliverables: XddDeliverableStatus[] = deliverablePaths.map((p) => {
		if (hasGlobMeta(p) && walked) {
			const reg = globToRegExp(p);
			const match = walked.find((f) => reg.test(f.replace(/\\/g, "/")));
			if (!match) return { path: p, exists: false, bytes: 0 };
			const st = safeStat(join(cwd, match));
			return { path: p, exists: !!st && st.isFile(), bytes: st?.size ?? 0 };
		}
		const full = join(cwd, p);
		const st = safeStat(full);
		return { path: p, exists: !!st && st.isFile(), bytes: st?.size ?? 0 };
	});

	const specDir = join(cwd, ".xdd", "design", "spec");
	const { rxx: specRxx, features: featureFiles } = scanXddSpec(specDir);
	const impls = scanImplements(cwd);
	const runtime = new RuntimeStore(cwd).load();
	const healing = runtime?.healingCases?.find((item) => item.id === runtime.activeHealingCaseId);

	return {
		deliverables,
		checkpointExists: existsSync(join(cwd, ".xdd", "checkpoint.json")),
		implementsCount: impls.count,
		implementsRxx: impls.rxx,
		specRxx,
		featureFiles,
		planTasks: scanXddPlan(cwd),
		activeHealing: healing ? { id: healing.id, failureCode: healing.failure.code, targetStage: healing.targetStage, status: healing.status, generation: runtime?.verifyGeneration ?? 0, receiptFresh: runtime?.lastVerifyReceipt?.generation === runtime?.verifyGeneration && runtime?.lastVerifyReceipt?.healingCaseId === healing.id, closureCriteria: healing.closureCriteria } : undefined,
	};
}

/** Human-readable rendering of the snapshot, for the xdd_observe tool output. */
export function renderFsSnapshot(snap: XddFsSnapshot): string {
	const lines: string[] = ["文件系统观测 (真实工程状态):"];
	if (snap.activeHealing) lines.push(`Active Healing: ${snap.activeHealing.id} ${snap.activeHealing.failureCode} → ${snap.activeHealing.targetStage} (${snap.activeHealing.status}) generation=${snap.activeHealing.generation} receipt=${snap.activeHealing.receiptFresh ? "fresh" : "stale/missing"}`, ...snap.activeHealing.closureCriteria.map((item) => `  closure: ${item}`));
	if (snap.deliverables.length > 0) {
		const dl = snap.deliverables
			.map((d) => `  ${d.exists ? "[有]" : "[无]"} ${d.path}${d.exists ? ` (${d.bytes}B)` : ""}`)
			.join("\n");
		lines.push(`阶段产物:`, dl);
	} else {
		lines.push("阶段产物: (本阶段软通过，无硬产物路径)");
	}
	lines.push(`checkpoint 可恢复: ${snap.checkpointExists ? "是 (.xdd/checkpoint.json)" : "否"}`);
	lines.push(`代码 @implements RXX: ${snap.implementsCount} 处${snap.implementsRxx.length > 0 ? ` (${snap.implementsRxx.join(", ")})` : ""}`);
	if (snap.specRxx.length > 0 || snap.featureFiles > 0) {
		lines.push(`.xdd spec: ${snap.specRxx.length} 条 RXX, ${snap.featureFiles} 个 feature`);
	}
	if (snap.planTasks.total > 0) {
		const t = snap.planTasks;
		lines.push(
			`.xdd plan 任务: ${t.done}/${t.total} 完成, ${t.inProgress} 进行, ${t.pending} 待办, ${t.blocked} 阻塞`,
		);
	}
	return lines.join("\n");
}

/** Trace-chain coverage: which spec RXX have a code @implements marker, which don't. */
export interface XddTraceCoverage {
	/** RXX ids declared in spec rules.md. */
	specRxx: string[];
	/** RXX ids found as @implements markers in code. */
	implementedRxx: string[];
	/** RXX declared in spec but with no @implements marker in code. */
	unimplemented: string[];
	/** @implements markers in code that reference no spec RXX (orphan / typo). */
	orphan: string[];
	featureFiles: number;
}

/** Compute the trace-chain coverage gaps from a filesystem snapshot. */
export function buildTraceCoverage(snap: XddFsSnapshot): XddTraceCoverage {
	const specSet = new Set(snap.specRxx);
	const implSet = new Set(snap.implementsRxx);
	const unimplemented = snap.specRxx.filter((r) => !implSet.has(r));
	const orphan = snap.implementsRxx.filter((r) => !specSet.has(r));
	return {
		specRxx: snap.specRxx,
		implementedRxx: snap.implementsRxx,
		unimplemented,
		orphan,
		featureFiles: snap.featureFiles,
	};
}
