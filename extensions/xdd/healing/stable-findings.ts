import { createHash } from "node:crypto";
import type { StableFinding, XddStageName } from "../types.ts";

export interface IncomingFinding { severity: "P0" | "P1" | "P2"; category: string; evidence: string }

export function stableFindingId(stage: XddStageName, finding: Pick<IncomingFinding, "category" | "evidence">): string {
	const normalized = finding.evidence.toLowerCase().replace(/\s+/g, " ").trim();
	return `F-${createHash("sha256").update(`${stage}\0${finding.category}\0${normalized}`).digest("hex").slice(0, 12)}`;
}

export function reconcileStableFindings(stage: XddStageName, previous: readonly StableFinding[], incoming: readonly IncomingFinding[], at = new Date().toISOString()): StableFinding[] {
	const seen = new Map(incoming.map((finding) => [stableFindingId(stage, finding), finding]));
	const result = previous.map((finding) => {
		const current = seen.get(finding.id);
		if (!current) return { ...finding, status: finding.status === "backlog" ? "backlog" as const : "closed" as const, lastSeenAt: at };
		seen.delete(finding.id);
		return { ...finding, severity: current.severity, evidence: current.evidence, status: current.severity === "P2" && finding.status === "backlog" ? "backlog" as const : "open" as const, lastSeenAt: at, recurrenceCount: finding.status === "closed" ? finding.recurrenceCount + 1 : finding.recurrenceCount };
	});
	const isResubmission = previous.length > 0;
	for (const [id, finding] of seen) result.push({ id, ...finding, status: isResubmission && finding.severity === "P2" ? "backlog" : "open", firstSeenAt: at, lastSeenAt: at, recurrenceCount: 1 });
	return result;
}

export function blockingFindings(findings: readonly StableFinding[]): StableFinding[] {
	return findings.filter((finding) => finding.status === "open");
}
