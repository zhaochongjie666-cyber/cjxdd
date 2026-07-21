import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
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

const QA_PLAN_FORMAT_HINT = `必须严格使用以下逐行格式（字段名不可加粗、不可拆成“字段名/值”两行、不可写成表格；RXX 应写入 plan task，不是 QA Category）：\n${QA_PLAN_ITEM_FORMAT}`;

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
	return block.match(new RegExp(`^- ${name}:\\s*\`?([^\`\\n]+)\`?\\s*$`, "mi"))?.[1]?.trim();
}

function duplicateFieldProblems(item: QaCase): string[] {
	const fieldNames = ["Category", "Feature", "Entry", "Expected", "Automation", "Applicability", "Reason"];
	return fieldNames.flatMap((name) => {
		const count = [...item.block.matchAll(new RegExp(`^- ${name}:`, "gmi"))].length;
		return count > 1 ? [`${item.id}.${name}：字段重复出现 ${count} 次；只保留一个权威值`] : [];
	});
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

function visibleLine(line: string): string {
	return line.trim().slice(0, 160) || "（空行）";
}

function categoryProblem(item: QaCase): string {
	if (item.category) {
		return `${item.id}.Category：值 \`${item.category}\` 非法；只允许 ${QA_CATEGORIES.map((value) => `\`${value}\``).join("、")}`;
	}
	const lines = item.block.split(/\r?\n/);
	const standalone = lines.find((line) => QA_CATEGORIES.includes(line.trim().replace(/^`|`$/g, "") as QaCategory));
	if (standalone) {
		const value = standalone.trim().replace(/^`|`$/g, "");
		return `${item.id}.Category：检测到独立值行 \`${visibleLine(standalone)}\`，解析器不会猜测字段归属；改为 \`- Category: ${value}\``;
	}
	const categoryLike = lines.find((line) => /category/i.test(line));
	if (categoryLike) {
		return `${item.id}.Category：无法解析行 \`${visibleLine(categoryLike)}\`；字段名和值必须写在同一行，例如 \`- Category: happy\``;
	}
	return `${item.id}.Category：字段缺失；在 ${item.id} 标题下新增 \`- Category: <六类之一>\``;
}

function incompleteProblems(item: QaCase): string[] {
	if (item.applicability === "not-applicable") {
		if (!item.reason) return [`${item.id}.Reason：声明 not-applicable 后缺少理由；新增 \`- Reason: <不少于 10 字的业务理由>\``];
		if (item.reason.length < 10) return [`${item.id}.Reason：理由仅 ${item.reason.length} 字，少于 10 字；补充具体业务理由`];
		return [];
	}
	const problems: string[] = [];
	if (!item.feature) problems.push(`${item.id}.Feature：缺失；新增精确 Scenario 锚，例如 - Feature: \`path.feature :: Scenario: exact name\``);
	if (!item.entry) problems.push(`${item.id}.Entry：缺失；新增公开 UI/CLI/API/event 入口`);
	if (!item.expected) problems.push(`${item.id}.Expected：缺失；新增外部可观察结果`);
	if (!item.automation) problems.push(`${item.id}.Automation：缺失；新增 \`- Automation: automated\` 或 \`- Automation: manual\``);
	else if (!/^(automated|manual)$/.test(item.automation)) problems.push(`${item.id}.Automation：值 \`${item.automation}\` 非法；只能是 \`automated\` 或 \`manual\``);
	return problems;
}

function repairMessage(title: string, problems: string[]): string {
	return `${title}\n问题定位：\n${problems.map((problem) => `- ${problem}`).join("\n")}\n修复方向：只修改上述 QA 项的对应字段；不要重排其他已通过项。修复后重新调用 xdd_submit_artifact。\n${QA_PLAN_FORMAT_HINT}`;
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
	if (!existsSync(path)) return { ok: false, reason: `QA Plan Gate: 缺少 .xdd/runs/xdd_run/qa-plan.md。\n修复方向：先按以下契约创建文件，再调用 xdd_submit_artifact。\n${QA_PLAN_FORMAT_HINT}` };
	const cases = parseQaPlan(readFileSync(path, "utf8"));
	if (cases.length === 0) return { ok: false, reason: `QA Plan Gate: 没有识别到任何 \`### QA-XXX\` 标题。\n修复方向：把每个测试项标题改为三级标题（例如 \`### QA-001\`），再逐项填写字段。\n${QA_PLAN_FORMAT_HINT}` };
	const duplicateIds = cases.filter((item, index) => cases.findIndex((candidate) => candidate.id === item.id) !== index).map((item) => item.id);
	if (duplicateIds.length > 0) return { ok: false, reason: `QA Plan Gate: 测试 ID 重复。\n问题定位：${[...new Set(duplicateIds)].map((id) => `\`${id}\` 出现 ${cases.filter((item) => item.id === id).length} 次`).join("；")}。\n修复方向：为重复项分配唯一 QA-ID，并同步后续 verify-report 引用。` };
	const duplicateFields = cases.flatMap(duplicateFieldProblems);
	if (duplicateFields.length > 0) return { ok: false, reason: repairMessage("QA Plan Gate: 测试项字段重复", duplicateFields) };
	const unknown = cases.filter((item) => !QA_CATEGORIES.includes(item.category as QaCategory));
	if (unknown.length > 0) return { ok: false, reason: repairMessage("QA Plan Gate: Category 非法或缺失", unknown.map(categoryProblem)) };
	const missingCategories = QA_CATEGORIES.filter((category) => !cases.some((item) => item.category === category));
	if (missingCategories.length > 0) return { ok: false, reason: `QA Plan Gate: 缺少类别决策。\n问题定位：${missingCategories.map((category) => `\`${category}\``).join("、")} 没有任何测试项或不适用决策。\n修复方向：逐类新增适用测试；确实不适用时新增 QA 项，并填写 \`- Category: <类别>\`、\`- Applicability: not-applicable\` 和不少于 10 字的 \`- Reason:\`。` };
	const incomplete = cases.filter((item) => {
		if (item.applicability === "not-applicable") return !item.reason || item.reason.length < 10;
		return !item.feature || !item.entry || !item.expected || !/^(automated|manual)$/.test(item.automation ?? "");
	});
	if (incomplete.length > 0) return { ok: false, reason: repairMessage("QA Plan Gate: 测试项字段不完整", incomplete.flatMap(incompleteProblems)) };
	const anchors = new Set(cases
		.filter((item) => item.applicability !== "not-applicable" && item.feature && item.entry && item.expected && /^(automated|manual)$/.test(item.automation ?? ""))
		.map((item) => item.feature));
	const missingScenarios = featureScenarios(cwd).filter((scenario) => !anchors.has(scenario));
	if (missingScenarios.length > 0) return { ok: false, reason: `QA Plan Gate: Feature Scenario 未覆盖。\n问题定位：\n${missingScenarios.map((scenario) => `- \`${scenario}\``).join("\n")}\n修复方向：为上面每个 Scenario 新增至少一个适用 QA 项，并将完整字符串原样写入 \`- Feature:\`；not-applicable 项不计入覆盖。` };
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
