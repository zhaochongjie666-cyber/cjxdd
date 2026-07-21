import { createHash } from "node:crypto";
import type { HealingBaseline, HealingFailure, VerifyReceipt, XddStageName } from "../types.ts";
import { captureSubjectDigests, computeCanonicalScopeDigest, computeScopeDigest } from "./content-digest.ts";

export function healingSignature(failure: Pick<HealingFailure, "code" | "reason" | "files">, target: XddStageName): string {
	const normalized = failure.reason.toLowerCase().replace(/\s+/g, " ").trim();
	return createHash("sha256").update([failure.code, target, normalized, [...failure.files].sort().join("\0")].join("\0")).digest("hex");
}

export function captureHealingBaseline(cwd: string, ownerScopes: readonly string[]): HealingBaseline {
	return { capturedAt: new Date().toISOString(), ownerScopeDigest: computeScopeDigest(cwd, ownerScopes), ownerScopeCanonicalDigest: computeCanonicalScopeDigest(cwd, ownerScopes), ...captureSubjectDigests(cwd) };
}

export function verifyReceiptMatches(cwd: string, receipt: VerifyReceipt, generation: number, healingCaseId?: string): { ok: boolean; code?: string; reason?: string } {
	if (receipt.generation !== generation || (healingCaseId !== undefined && receipt.healingCaseId !== healingCaseId)) return { ok: false, code: "EVIDENCE_STALE_AFTER_ROLLBACK", reason: "verify receipt generation/healingCaseId 已过期；请重新运行 Harness。" };
	const current = captureSubjectDigests(cwd);
	if (receipt.productionDigest !== current.productionDigest || receipt.designDigest !== current.designDigest || receipt.planDigest !== current.planDigest) return { ok: false, code: "EVIDENCE_SUBJECT_MISMATCH", reason: "源码、设计或计划在验证回执后发生变化；请重新运行 Harness。" };
	if (receipt.commands.length === 0 || receipt.commands.some((command) => command.exitCode !== 0)) return { ok: false, code: "VERIFY_COMMAND_FAILED", reason: "Controller Harness receipt 缺失成功命令。" };
	return { ok: true };
}
