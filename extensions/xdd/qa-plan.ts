import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { XddGateResult } from "./types.ts";
import { evaluateLegacyQualityWaiver } from "./quality-migration.ts";

export const QA_CATEGORIES = ["happy", "rejection", "boundary", "concurrency", "dependency-failure", "load"] as const;
export type QaCategory = typeof QA_CATEGORIES[number];

interface QaCase {
	id: string;
	category?: string;
	feature?: string;
	entry?: string;
	expected?: string;
	automation?: string;
	applicability?: string;
	reason?: string;
}

function field(block: string, name: string): string | undefined {
	return block.match(new RegExp(`^- ${name}:\\s*\`?([^\`\\n]+)\`?\\s*$`, "mi"))?.[1]?.trim();
}

export function parseQaPlan(markdown: string): QaCase[] {
	return markdown.split(/^###\s+(QA-[A-Z0-9-]+)\s*$/gm).slice(1).reduce<QaCase[]>((cases, value, index, parts) => {
		if (index % 2 === 0) {
			const block = parts[index + 1] ?? "";
			cases.push({
				id: value,
				category: field(block, "Category"),
				feature: field(block, "Feature"),
				entry: field(block, "Entry"),
				expected: field(block, "Expected"),
				automation: field(block, "Automation"),
				applicability: field(block, "Applicability"),
				reason: field(block, "Reason"),
			});
		}
		return cases;
	}, []);
}

function walk(root: string): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(root)) {
		const path = join(root, entry);
		if (statSync(path).isDirectory()) files.push(...walk(path));
		else files.push(path);
	}
	return files;
}

function featureScenarios(cwd: string): string[] {
	const root = join(cwd, ".xdd", "design", "spec");
	return walk(root).filter((path) => path.endsWith(".feature")).flatMap((path) => {
		const featurePath = relative(root, path).replaceAll("\\", "/");
		return [...readFileSync(path, "utf8").matchAll(/^\s*(Scenario(?: Outline)?):\s*(.+?)\s*$/gm)]
			.map((match) => `${featurePath} :: ${match[1]}: ${match[2]}`);
	});
}

export function evaluateQaPlanGate(cwd: string): XddGateResult {
	const path = join(cwd, ".xdd", "runs", "xdd_run", "qa-plan.md");
	if (!existsSync(path)) return { ok: false, reason: "QA Plan Gate: 缺少 .xdd/runs/xdd_run/qa-plan.md" };
	const cases = parseQaPlan(readFileSync(path, "utf8"));
	if (cases.length === 0) return { ok: false, reason: "QA Plan Gate: 没有 ### QA-XXX 测试项" };
	const duplicateIds = cases.filter((item, index) => cases.findIndex((candidate) => candidate.id === item.id) !== index).map((item) => item.id);
	if (duplicateIds.length > 0) return { ok: false, reason: `QA Plan Gate: 测试 ID 重复：${[...new Set(duplicateIds)].join(", ")}` };
	const unknown = cases.filter((item) => !QA_CATEGORIES.includes(item.category as QaCategory));
	if (unknown.length > 0) return { ok: false, reason: `QA Plan Gate: Category 非法或缺失：${unknown.map((item) => item.id).join(", ")}` };
	const missingCategories = QA_CATEGORIES.filter((category) => !cases.some((item) => item.category === category));
	if (missingCategories.length > 0) return { ok: false, reason: `QA Plan Gate: 缺少类别决策：${missingCategories.join(", ")}` };
	const incomplete = cases.filter((item) => {
		if (item.applicability === "not-applicable") return !item.reason || item.reason.length < 10;
		return !item.feature || !item.entry || !item.expected || !/^(automated|manual)$/.test(item.automation ?? "");
	});
	if (incomplete.length > 0) return { ok: false, reason: `QA Plan Gate: 测试项字段不完整：${incomplete.map((item) => item.id).join(", ")}` };
	const anchors = new Set(cases
		.filter((item) => item.applicability !== "not-applicable" && item.feature && item.entry && item.expected && /^(automated|manual)$/.test(item.automation ?? ""))
		.map((item) => item.feature));
	const missingScenarios = featureScenarios(cwd).filter((scenario) => !anchors.has(scenario));
	if (missingScenarios.length > 0) return { ok: false, reason: `QA Plan Gate: Feature Scenario 未覆盖：${missingScenarios.join("；")}` };
	return { ok: true };
}

export function evaluateQaEvidenceGate(cwd: string): XddGateResult {
	const planPath = join(cwd, ".xdd", "runs", "xdd_run", "qa-plan.md");
	const reportPath = join(cwd, ".xdd", "runs", "xdd_run", "verify-report.md");
	if (!existsSync(reportPath)) return { ok: false, reason: "QA Evidence Gate: 缺少 verify-report.md" };
	if (!existsSync(planPath)) {
		if (evaluateLegacyQualityWaiver(cwd, "frozen-qa-plan")) return { ok: true, soft: true, reason: "QA Evidence Gate: 旧 run 在实现后升级，已审计豁免不可追溯补造的冻结 QA；仍要求当前 verify 证据" };
		return { ok: false, reason: "QA Evidence Gate: 缺少冻结的 qa-plan.md；若这是升级前已越过 plan 的旧 run，请先调用 xdd_migrate_quality" };
	}
	const applicable = parseQaPlan(readFileSync(planPath, "utf8")).filter((item) => item.applicability !== "not-applicable");
	const report = readFileSync(reportPath, "utf8");
	const missing = applicable.filter((item) => !new RegExp(`\\b${item.id}\\b[^\\n]*(?:PASS|✅)`, "i").test(report));
	if (missing.length > 0) return { ok: false, reason: `QA Evidence Gate: 测试项缺少 PASS 运行证据：${missing.map((item) => item.id).join(", ")}` };
	return { ok: true };
}
