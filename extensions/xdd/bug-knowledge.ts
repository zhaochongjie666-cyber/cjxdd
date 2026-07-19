import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const BUG_CATEGORIES = ["permission", "data-integrity", "concurrency", "resource-leak", "dependency", "performance", "contract", "resilience", "other"] as const;
export type BugCategory = typeof BUG_CATEGORIES[number];

export interface BugLearning {
	category: BugCategory;
	component: string;
	symptom: string;
	rootCause: string;
	resolution: string;
	prevention: string;
	rollbackTarget: "spec" | "architecture" | "execute" | "resilience" | "verify";
	source: { kind: "runtime-incident" | "code-review" | "commit-review" | "qa" | "manual"; id: string };
	evidence: string[];
}

export interface BugPattern extends BugLearning {
	schemaVersion: 1;
	id: string;
	fingerprint: string;
	occurrences: number;
	firstSeenAt: string;
	lastSeenAt: string;
}

export interface BugKnowledgeBase {
	schemaVersion: 1;
	patterns: BugPattern[];
}

export interface PreventionRule {
	id: string;
	patternId: string;
	gate: "requirement" | "architecture" | "code-review" | "commit-review" | "qa" | "runtime";
	assertion: string;
	severity: "P1" | "P2";
}

function knowledgePath(cwd: string): string {
	return join(cwd, ".xdd", "knowledge", "bug-patterns.json");
}

function normalize(value: string): string {
	return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function bugFingerprint(learning: Pick<BugLearning, "category" | "component" | "rootCause">): string {
	const identity = [learning.category, normalize(learning.component), normalize(learning.rootCause)].join("\0");
	return `sha256:${createHash("sha256").update(identity).digest("hex")}`;
}

export function readBugKnowledgeBase(cwd: string): BugKnowledgeBase {
	try {
		const value = JSON.parse(readFileSync(knowledgePath(cwd), "utf8")) as BugKnowledgeBase;
		return value.schemaVersion === 1 && Array.isArray(value.patterns) ? value : { schemaVersion: 1, patterns: [] };
	} catch {
		return { schemaVersion: 1, patterns: [] };
	}
}

function validateLearning(learning: BugLearning): void {
	for (const [name, value] of Object.entries({ component: learning.component, symptom: learning.symptom, rootCause: learning.rootCause, resolution: learning.resolution, prevention: learning.prevention })) {
		if (value.trim().length < 8) throw new Error(`${name} 必须包含至少 8 个字符的具体信息`);
	}
	if (!learning.source.id.trim()) throw new Error("source.id 不能为空");
	if (learning.evidence.length === 0 || learning.evidence.some((item) => !item.trim())) throw new Error("至少需要一条非空修复证据");
}

export function recordBugLearning(cwd: string, learning: BugLearning, now = new Date().toISOString()): BugPattern {
	validateLearning(learning);
	const base = readBugKnowledgeBase(cwd);
	const fingerprint = bugFingerprint(learning);
	const existing = base.patterns.find((pattern) => pattern.fingerprint === fingerprint);
	let pattern: BugPattern;
	if (existing) {
		existing.occurrences += 1;
		existing.lastSeenAt = now;
		existing.symptom = learning.symptom;
		existing.resolution = learning.resolution;
		existing.prevention = learning.prevention;
		existing.source = learning.source;
		existing.evidence = [...new Set([...existing.evidence, ...learning.evidence])];
		pattern = existing;
	} else {
		pattern = { schemaVersion: 1, ...learning, id: `bug_${fingerprint.slice(7, 19)}`, fingerprint, occurrences: 1, firstSeenAt: now, lastSeenAt: now };
		base.patterns.push(pattern);
	}
	base.patterns.sort((a, b) => a.id.localeCompare(b.id));
	const path = knowledgePath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(base, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
	return pattern;
}

export function findMatchingBugPatterns(cwd: string, query: { category?: BugCategory; component?: string; text?: string }): BugPattern[] {
	const component = query.component ? normalize(query.component) : "";
	const tokens = new Set(normalize(query.text ?? "").split(" ").filter((token) => token.length > 2));
	return readBugKnowledgeBase(cwd).patterns
		.filter((pattern) => !query.category || pattern.category === query.category)
		.filter((pattern) => !component || normalize(pattern.component).includes(component) || component.includes(normalize(pattern.component)))
		.map((pattern) => ({ pattern, score: [...tokens].filter((token) => normalize(`${pattern.symptom} ${pattern.rootCause} ${pattern.prevention}`).includes(token)).length }))
		.filter(({ score }) => tokens.size === 0 || score > 0)
		.sort((a, b) => b.score - a.score || b.pattern.occurrences - a.pattern.occurrences)
		.map(({ pattern }) => pattern);
}

export function generatePreventionRule(pattern: BugPattern): PreventionRule {
	const gateByTarget: Record<BugPattern["rollbackTarget"], PreventionRule["gate"]> = {
		spec: "requirement", architecture: "architecture", execute: "code-review", resilience: "runtime", verify: "qa",
	};
	return {
		id: `prevent_${pattern.id}`,
		patternId: pattern.id,
		gate: gateByTarget[pattern.rollbackTarget],
		assertion: pattern.prevention,
		severity: pattern.occurrences > 1 || ["permission", "data-integrity", "resilience"].includes(pattern.category) ? "P1" : "P2",
	};
}
