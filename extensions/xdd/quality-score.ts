import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readBugKnowledgeBase } from "./bug-knowledge.ts";
import type { XddGateResult } from "./types.ts";

export interface QualityMetric {
	name: "recurrence-rate" | "escaped-defects" | "mean-time-to-repair" | "soft-overrides" | "evidence-coverage";
	value: number | null;
	unit: "percent" | "count" | "hours";
	penalty: number;
	detail: string;
}

export interface QualityScore {
	schemaVersion: 1;
	inputDigest: string;
	score: number;
	status: "healthy" | "warning" | "critical";
	metrics: QualityMetric[];
	recommendations: string[];
	createdAt: string;
}

function runRoot(cwd: string): string {
	return join(cwd, ".xdd", "runs", "xdd_run");
}

function scoreInputs(cwd: string): string[] {
	const run = runRoot(cwd);
	const paths = [
		join(run, "qa-plan.md"), join(run, "verify-report.md"), join(run, "code-review.json"), join(run, "commit-review.json"),
		join(run, "runtime-observability", "incident.json"), join(cwd, ".xdd", "knowledge", "bug-patterns.json"),
	];
	try {
		for (const entry of readdirSync(join(run, "reviews"))) paths.push(join(run, "reviews", entry));
	} catch { /* A legacy run may not have structured reviews. */ }
	return paths.sort();
}

export function qualityScoreInputDigest(cwd: string): string {
	const hash = createHash("sha256");
	for (const path of scoreInputs(cwd)) {
		hash.update(path).update("\0").update(existsSync(path) ? readFileSync(path) : Buffer.from("<missing>")).update("\0");
	}
	return `sha256:${hash.digest("hex")}`;
}

function readJson(path: string): any | null {
	try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function buildQualityScore(cwd: string, now = new Date().toISOString()): QualityScore {
	const run = runRoot(cwd);
	const patterns = readBugKnowledgeBase(cwd).patterns;
	const occurrences = patterns.reduce((sum, pattern) => sum + pattern.occurrences, 0);
	const repeats = patterns.reduce((sum, pattern) => sum + Math.max(0, pattern.occurrences - 1), 0);
	const recurrenceRate = occurrences === 0 ? 0 : (repeats / occurrences) * 100;
	const incident = readJson(join(run, "runtime-observability", "incident.json"));
	const escaped = Array.isArray(incident?.findings) ? incident.findings.length : 0;

	const reviewFiles = scoreInputs(cwd).filter((path) => path.includes("/reviews/") || /(?:code|commit)-review\.json$/.test(path));
	const reviews = reviewFiles.map(readJson).filter(Boolean);
	const overrides = reviews.filter((review) => review.override).length;
	const evidenceChecks = [
		existsSync(join(run, "qa-plan.md")), existsSync(join(run, "verify-report.md")),
		existsSync(join(run, "code-review.json")), existsSync(join(run, "commit-review.json")),
		Boolean(incident),
	];
	const evidenceCoverage = (evidenceChecks.filter(Boolean).length / evidenceChecks.length) * 100;

	let repairHours: number | null = null;
	if (incident?.createdAt) {
		const learned = patterns.filter((pattern) => pattern.source.kind === "runtime-incident" && pattern.source.id === incident.deploymentId);
		const durations = learned.map((pattern) => (Date.parse(pattern.lastSeenAt) - Date.parse(incident.createdAt)) / 3_600_000).filter((value) => Number.isFinite(value) && value >= 0);
		if (durations.length > 0) repairHours = durations.reduce((sum, value) => sum + value, 0) / durations.length;
	}

	const metrics: QualityMetric[] = [
		{ name: "recurrence-rate", value: recurrenceRate, unit: "percent", penalty: Math.min(20, Math.round(recurrenceRate / 5)), detail: `${repeats}/${occurrences} 次缺陷属于重复根因` },
		{ name: "escaped-defects", value: escaped, unit: "count", penalty: Math.min(30, escaped * 10), detail: `${escaped} 个缺陷逃逸到 runtime observation` },
		{ name: "mean-time-to-repair", value: repairHours, unit: "hours", penalty: repairHours === null ? 0 : Math.min(15, Math.floor(repairHours / 24) * 3), detail: repairHours === null ? "暂无可关联的 incident→修复样本，不惩罚" : `平均 ${repairHours.toFixed(1)} 小时` },
		{ name: "soft-overrides", value: overrides, unit: "count", penalty: Math.min(15, overrides * 3), detail: `${overrides} 次有审计记录的软 Gate override` },
		{ name: "evidence-coverage", value: evidenceCoverage, unit: "percent", penalty: Math.round((100 - evidenceCoverage) * 0.2), detail: `${evidenceChecks.filter(Boolean).length}/${evidenceChecks.length} 类关键证据可用` },
	];
	const score = Math.max(0, 100 - metrics.reduce((sum, metric) => sum + metric.penalty, 0));
	const recommendations = metrics.filter((metric) => metric.penalty > 0).sort((a, b) => b.penalty - a.penalty).map((metric) => `优先降低 ${metric.name}：${metric.detail}`);
	return { schemaVersion: 1, inputDigest: qualityScoreInputDigest(cwd), score, status: score >= 80 ? "healthy" : score >= 60 ? "warning" : "critical", metrics, recommendations, createdAt: now };
}

export function writeQualityScore(cwd: string, score: QualityScore): string {
	const path = join(runRoot(cwd), "quality-score.json");
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(score, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
	return path;
}

export function evaluateQualityScoreGate(cwd: string): XddGateResult {
	const score = readJson(join(runRoot(cwd), "quality-score.json")) as QualityScore | null;
	if (!score) return { ok: false, reason: "Quality Score: 缺少 quality-score.json" };
	if (score.inputDigest !== qualityScoreInputDigest(cwd)) return { ok: false, reason: "Quality Score: 上游质量证据变化，旧评分失效" };
	// The score is diagnostic, not a second hard Gate. Existing P1/mechanical blockers
	// remain owned by Release Decision; a low score supplies priorities without loops.
	return { ok: true, soft: score.status !== "healthy", reason: score.status === "healthy" ? undefined : `Quality Score=${score.score}，按 recommendations 持续改进` };
}
