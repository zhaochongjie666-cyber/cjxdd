import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { XddGateResult } from "./types.ts";
import { buildPreventionContext } from "./prevention-context.ts";

export interface RuntimeMetric {
	name: string;
	value: number;
	unit: string;
	direction: "lower" | "higher";
	maxRegressionPct: number;
	critical: boolean;
}

export interface RuntimeObservation {
	schemaVersion: 1;
	deploymentId: string;
	commitSha: string;
	capturedAt: string;
	metrics: RuntimeMetric[];
	logs: string[];
	traces: string[];
}

export interface RuntimeFinding {
	metric: string;
	baseline: number;
	observed?: number;
	regressionPct?: number;
	severity: "P1" | "P2";
	reason: string;
}

export interface RuntimeIncident {
	schemaVersion: 1;
	deploymentId: string;
	commitSha: string;
	status: "open" | "clear";
	findings: RuntimeFinding[];
	rollbackTarget: "execute" | "resilience";
	difference: {
		desired: string;
		current: string;
		tasks: string[];
	};
	createdAt: string;
	preventionPatternIds?: string[];
}

function redactText(value: string): string {
	return value
		.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
		.replace(/(["']?)(api[_-]?key|token|password|secret)\1\s*([=:])\s*(?:(["'])(.*?)\4|[^\s,;}]+)/gi, (_match, keyQuote: string, key: string, separator: string, valueQuote = "") => `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[REDACTED]${valueQuote}`)
		.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
		.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]");
}

export function sanitizeRuntimeObservation(observation: RuntimeObservation): RuntimeObservation {
	return {
		...observation,
		logs: observation.logs.map(redactText),
		traces: observation.traces.map(redactText),
	};
}

function atomicJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}

function root(cwd: string): string {
	return join(cwd, ".xdd", "runs", "xdd_run", "runtime-observability");
}

export function writeRuntimeBaseline(cwd: string, observation: RuntimeObservation): string {
	const path = join(root(cwd), "baseline.json");
	atomicJson(path, sanitizeRuntimeObservation(observation));
	return path;
}

export function evaluateRuntimeObservation(baseline: RuntimeObservation, observation: RuntimeObservation): RuntimeIncident {
	const current = new Map(observation.metrics.map((metric) => [metric.name, metric]));
	const findings: RuntimeFinding[] = [];
	for (const expected of baseline.metrics) {
		const actual = current.get(expected.name);
		if (!actual || !Number.isFinite(actual.value)) {
			findings.push({ metric: expected.name, baseline: expected.value, severity: "P1", reason: "关键运行指标缺失或不是有限数值" });
			continue;
		}
		const denominator = Math.max(Math.abs(expected.value), 1e-9);
		const delta = expected.direction === "lower" ? actual.value - expected.value : expected.value - actual.value;
		const regressionPct = (delta / denominator) * 100;
		if (regressionPct > expected.maxRegressionPct) {
			findings.push({ metric: expected.name, baseline: expected.value, observed: actual.value, regressionPct, severity: expected.critical ? "P1" : "P2", reason: `超过允许回归 ${expected.maxRegressionPct}%` });
		}
	}
	return {
		schemaVersion: 1,
		deploymentId: observation.deploymentId,
		commitSha: observation.commitSha,
		status: findings.length > 0 ? "open" : "clear",
		findings,
		rollbackTarget: findings.some((finding) => /缺失/.test(finding.reason)) ? "resilience" : "execute",
		difference: {
			desired: "当前部署的全部必需指标存在，且相对稳定基线不超过各自允许回归阈值",
			current: findings.length > 0 ? findings.map((finding) => `${finding.metric}: ${finding.reason}`).join("；") : "指标在允许范围内",
			tasks: findings.map((finding) => `${finding.severity} 调查 ${finding.metric}，修复后重新部署并再次调用 xdd_runtime_observe`),
		},
		createdAt: new Date().toISOString(),
	};
}

export function recordRuntimeObservation(cwd: string, observation: RuntimeObservation): RuntimeIncident {
	const baseline = JSON.parse(readFileSync(join(root(cwd), "baseline.json"), "utf8")) as RuntimeObservation;
	const sanitized = sanitizeRuntimeObservation(observation);
	const incident = evaluateRuntimeObservation(baseline, sanitized);
	const prevention = buildPreventionContext(cwd, "runtime", `${incident.difference.current}\n${sanitized.metrics.map((metric) => metric.name).join(" ")}`);
	incident.preventionPatternIds = prevention.patternIds;
	if (prevention.text) incident.difference.tasks.push(...prevention.text.split("\n").filter((line) => line.startsWith("- [")).map((line) => `历史预防规则 ${line.slice(2)}`));
	atomicJson(join(root(cwd), "latest.json"), sanitized);
	atomicJson(join(root(cwd), "incident.json"), incident);
	return incident;
}

export function evaluateRuntimeObservabilityGate(cwd: string): XddGateResult {
	try {
		readFileSync(join(root(cwd), "baseline.json"), "utf8");
	} catch {
		// Preserve the usable legacy flow for projects without a deployable runtime.
		// Once a project opts in by writing a baseline, latest/incident become strict.
		return { ok: true, soft: true, reason: "Runtime Gate: 项目未配置稳定基线，按不适用软跳过" };
	}
	let observation: RuntimeObservation;
	let incident: RuntimeIncident;
	try {
		observation = JSON.parse(readFileSync(join(root(cwd), "latest.json"), "utf8")) as RuntimeObservation;
		incident = JSON.parse(readFileSync(join(root(cwd), "incident.json"), "utf8")) as RuntimeIncident;
	} catch {
		return { ok: false, reason: "Runtime Gate: 缺少 baseline 后的 latest observation/incident" };
	}
	let head = "";
	try {
		head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
	} catch {
		return { ok: false, reason: "Runtime Gate: 无法读取 HEAD commit" };
	}
	if (observation.commitSha !== head || incident.commitSha !== head) return { ok: false, reason: "Runtime Gate: observation/incident 未绑定当前 HEAD" };
	const blockers = incident.findings.filter((finding) => finding.severity === "P1");
	if (blockers.length > 0) return { ok: false, reason: `Runtime Gate: P1 回归：${blockers.map((finding) => finding.metric).join(", ")}` };
	return { ok: true, soft: incident.findings.some((finding) => finding.severity === "P2") };
}
