import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generatePreventionRule, readBugKnowledgeBase, type BugCategory, type BugPattern } from "./bug-knowledge.ts";
import type { XddStageName } from "./types.ts";

export interface PreventionInjection {
	stage: XddStageName | "commit" | "runtime";
	contextDigest: string;
	patternIds: string[];
	at: string;
}

const CATEGORIES: Partial<Record<XddStageName | "commit" | "runtime", BugCategory[]>> = {
	understand: ["permission", "data-integrity", "contract", "other"],
	spec: ["permission", "data-integrity", "contract", "other"],
	architecture: ["data-integrity", "concurrency", "resource-leak", "dependency", "performance", "resilience"],
	wire: ["permission", "contract", "dependency", "other"],
	resilience: ["concurrency", "resource-leak", "dependency", "performance", "resilience"],
	plan: ["permission", "data-integrity", "concurrency", "dependency", "performance", "contract", "resilience"],
	execute: ["permission", "data-integrity", "concurrency", "resource-leak", "dependency", "performance", "contract", "resilience", "other"],
	cleanup: ["resource-leak", "contract", "other"],
	verify: ["permission", "data-integrity", "concurrency", "dependency", "performance", "contract", "resilience", "other"],
	commit: ["permission", "data-integrity", "concurrency", "resource-leak", "dependency", "contract", "resilience"],
	runtime: ["concurrency", "resource-leak", "dependency", "performance", "resilience"],
};

function normalize(value: string): string[] {
	const normalized = value.normalize("NFKC").toLowerCase();
	const words = normalized.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2 && !/[\p{Script=Han}]/u.test(token));
	const cjk = [...normalized.matchAll(/[\p{Script=Han}]{2,}/gu)].flatMap(([run]) => [...run].slice(0, -1).map((char, index, chars) => `${char}${chars[index + 1]}`));
	return [...new Set([...words, ...cjk])];
}

function relevance(pattern: BugPattern, query: string): number {
	const haystack = `${pattern.component} ${pattern.symptom} ${pattern.rootCause} ${pattern.prevention}`.toLowerCase();
	return normalize(query).filter((token) => haystack.includes(token)).length;
}

function auditPath(cwd: string): string {
	return join(cwd, ".xdd", "runs", "xdd_run", "prevention-injections.json");
}

function recordInjection(cwd: string, injection: PreventionInjection): void {
	let entries: PreventionInjection[] = [];
	try { entries = JSON.parse(readFileSync(auditPath(cwd), "utf8")) as PreventionInjection[]; } catch { /* first injection */ }
	if (!entries.some((item) => item.stage === injection.stage && item.contextDigest === injection.contextDigest)) entries.push(injection);
	const path = auditPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(entries.slice(-100), null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}

export function buildPreventionContext(cwd: string, stage: XddStageName | "commit" | "runtime", query: string, limit = 5): { text: string; patternIds: string[] } {
	const categories = CATEGORIES[stage] ?? [];
	const candidates = readBugKnowledgeBase(cwd).patterns
		.filter((pattern) => categories.includes(pattern.category))
		.map((pattern) => ({ pattern, score: relevance(pattern, query) }))
		.sort((a, b) => b.score - a.score || b.pattern.occurrences - a.pattern.occurrences || b.pattern.lastSeenAt.localeCompare(a.pattern.lastSeenAt));
	const selected = candidates.filter((item) => item.score > 0).slice(0, Math.max(0, limit)).map((item) => item.pattern);
	if (selected.length === 0) return { text: "", patternIds: [] };
	const patternIds = selected.map((pattern) => pattern.id);
	const lines = selected.map((pattern) => {
		const rule = generatePreventionRule(pattern);
		return `- [${pattern.id}] ${pattern.category}/${pattern.component}（历史 ${pattern.occurrences} 次，${rule.severity}）：${rule.assertion}`;
	});
	const contextDigest = `sha256:${createHash("sha256").update(stage).update("\0").update(lines.join("\n")).digest("hex")}`;
	recordInjection(cwd, { stage, contextDigest, patternIds, at: new Date().toISOString() });
	return {
		patternIds,
		text: `[历史缺陷预防规则 · 只攻击相关风险，不机械照抄]\n${lines.join("\n")}\n审查或实现时必须说明命中的 Pattern ID；不相关规则可说明 N/A，不得因此制造无关返工。`,
	};
}
