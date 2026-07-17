import { observeFilesystem, type XddFsSnapshot } from "./observe-fs.ts";
import type { XddGateResult, XddStageSpec } from "./types.ts";

/**
 * Pure stage-difference computation, shared by the xdd control-loop tools
 * (tools/xdd-difference.ts).
 *
 * This is the Compare phase of the Controller cycle (core.md): it runs the
 * stage's REAL hard gate (filesystem-backed) plus a desiredState classification
 * grounded in disk observation - never keyword guessing, never self-reported
 * "complete" signals. core.md principle 3 (Gate decides advancement).
 */

export interface DesiredStateCheck {
	index: number;
	item: string;
	/** "met" = hard evidence; "unmet" = hard evidence of not-done; "self-check" = cannot auto-verify */
	status: "met" | "unmet" | "self-check";
}

export interface StageDifference {
	stageName: string;
	gate: XddGateResult;
	checks: DesiredStateCheck[];
	metCount: number;
	unmetCount: number;
	selfCheckCount: number;
	fsSnap: XddFsSnapshot;
}

export interface StageDiffContext {
	/** Artifacts the runner recorded as submitted (in-memory bookkeeping). */
	artifacts: string[];
}

/**
 * Classify a desiredState item against real signals (NOT keyword guessing).
 *
 * - artifact-producing items are "met" only when a declared deliverable exists on disk.
 * - everything else is "self-check": refuse to fake satisfaction.
 */
export function classifyDesiredStateItem(
	item: string,
	ctx: { fsSnap: XddFsSnapshot },
): DesiredStateCheck["status"] {
	if (
		item.includes("产出") ||
		item.includes("创建") ||
		item.includes("生成") ||
		item.includes("删除") ||
		item.includes("统一") ||
		item.includes("剔除") ||
		item.includes("更新")
	) {
		// Stages without deliverablePaths (git-based: wire/execute/cleanup) have
		// no file deliverable to verify against; their action items are attested
		// by the gitHasChanges gate, so classify as self-check instead of unmet.
		if (ctx.fsSnap.deliverables.length === 0) return "self-check";
		const hasDeliverable = ctx.fsSnap.deliverables.some((d) => d.exists && d.bytes > 0);
		return hasDeliverable ? "met" : "unmet";
	}
	return "self-check";
}

/**
 * Run the real hard gate + classify every desiredState item against the disk.
 * `ctx` carries in-memory runner signals (artifacts / self-attack).
 */
export async function computeStageDifference(
	cwd: string,
	stage: XddStageSpec,
	ctx: StageDiffContext,
): Promise<StageDifference> {
	const fsSnap = observeFilesystem(cwd, stage.deliverablePaths);
	const gate = await stage.gate({
		cwd,
		summary: ctx.artifacts.join(", "),
		desiredState: stage.desiredState,
	});
	const checks: DesiredStateCheck[] = stage.desiredState.map((item, i) => ({
		index: i + 1,
		item,
		status: classifyDesiredStateItem(item, { fsSnap }),
	}));
	const metCount = checks.filter((c) => c.status === "met").length;
	const unmetCount = checks.filter((c) => c.status === "unmet").length;
	const selfCheckCount = checks.filter((c) => c.status === "self-check").length;
	return { stageName: stage.name, gate, checks, metCount, unmetCount, selfCheckCount, fsSnap };
}

/** Render a StageDifference to text. `artifacts`/`selfHealRemaining` are runner-only (optional). */
export function renderStageDifference(diff: StageDifference, opts?: { artifacts?: string[]; selfHealRemaining?: number; maxSelfHeal?: number }): string {
	const unmet = diff.checks.filter((c) => c.status === "unmet");
	const selfCheck = diff.checks.filter((c) => c.status === "self-check");
	const artifacts = opts?.artifacts ?? [];
	const lines = [
		`阶段: ${diff.stageName}`,
		`硬 Gate: ${diff.gate.ok ? (diff.gate.soft ? "软通过（无硬产物可验）" : "通过") : "未通过"}`,
		`Desired State: ${diff.metCount}/${diff.checks.length} 已满足（${diff.selfCheckCount} 项需自检）`,
		`已提交产物: ${artifacts.length > 0 ? artifacts.join(", ") : "(无)"}`,
	];
	if (opts && opts.selfHealRemaining !== undefined && opts.maxSelfHeal !== undefined) {
		lines.push(`自愈预算剩余: ${opts.selfHealRemaining}/${opts.maxSelfHeal}`);
	}
	if (!diff.gate.ok) {
		lines.push("", "Gate 失败原因（提交前必先修复）:", `  ${diff.gate.reason ?? "未知"}`);
	}
	if (unmet.length > 0) {
		lines.push("", "未满足条件（有硬证据判定未达标）:");
		for (const c of unmet) lines.push(`  [${c.index}] ${c.item}`);
	}
	if (selfCheck.length > 0) {
		lines.push("", "需自检条件（无法自动验证，须由你举证）:");
		for (const c of selfCheck) lines.push(`  [${c.index}] ${c.item}`);
	}
	if (diff.gate.ok && unmet.length === 0) {
		lines.push(
			"",
			selfCheck.length > 0
				? "硬 Gate 已过，但仍有需自检项。确认自检项也为真后，调 xdd_submit_artifact 提交。"
				: "所有 Desired State 条目已满足，可调用 xdd_submit_artifact 提交。",
		);
	} else if (!diff.gate.ok) {
		lines.push("", "Gate 未通过：修复上述原因后重跑本工具复查。");
	}
	return lines.join("\n");
}
