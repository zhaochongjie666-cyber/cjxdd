import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { XddGateResult } from "./types.ts";
import { evaluateLegacyQualityWaiver } from "./quality-migration.ts";

export const QA_CATEGORIES = ["happy", "rejection", "boundary", "concurrency", "dependency-failure", "load"] as const;
export type QaCategory = typeof QA_CATEGORIES[number];

export const QA_PLAN_ITEM_FORMAT = `### QA-001
- Category: happy
- Feature: \`path/example.feature :: Scenario: exact name\`
- Entry: public UI/CLI/API/event entry
- Expected: observable result
- Automation: automated`;

interface QaCase {
	id: string;
	block: string;
	category?: string;
	feature?: string;
	entry?: string;
	expected?: string;
	automation?: string;
	applicability?: string;
	reason?: string;
}

function field(block: string, name: string): string | undefined {
	const m = block.match(new RegExp(`^- ${name}:\\s*(.+)$`, "mi"));
	if (!m) return undefined;
	return m[1].trim().replace(/^`|`$/g, "");
}

export function parseQaPlan(markdown: string): QaCase[] {
	return markdown.split(/^###\s+(QA-[A-Z0-9-]+)\s*$/gm).slice(1).reduce<QaCase[]>((cases, value, index, parts) => {
		if (index % 2 === 0) {
			const block = parts[index + 1] ?? "";
			cases.push({
				id: value,
				block,
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
