/** NF 合并辅助模块：skill 加载 + scaffold + flow budget + archive + stage diff。 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { observeFilesystem, type NfFsSnapshot } from "./observe-fs.ts";
import type { NfGateResult, NfStageSpec } from "./types.ts";

// ── skill loader ─────────────────────────────────────────────────────────

export function loadNfSkills(cwd: string): Skill[] {
	const dirs = [join(cwd, "skills"), join(cwd, ".pi", "skills"), join(homedir(), ".pi", "agent", "skills"), join(homedir(), ".agents", "skills")];
	const seen = new Map<string, Skill>();
	for (const dir of dirs) for (const s of scanSkillDir(dir)) if (!seen.has(s.name)) seen.set(s.name, s);
	return [...seen.values()];
}
function scanSkillDir(dir: string): Skill[] {
	if (!existsSync(dir)) return [];
	let entries: string[];
	try { entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("xdd-")).map((e) => e.name); } catch { return []; }
	const skills: Skill[] = [];
	for (const name of entries.sort()) {
		const skillMd = join(dir, name, "SKILL.md");
		if (!existsSync(skillMd)) continue;
		const fm = parseFrontmatter(readFileSync(skillMd, "utf8"));
		skills.push({ name: fm.name ?? name, description: fm.description ?? "", filePath: skillMd, baseDir: join(dir, name), sourceInfo: { path: skillMd, source: "nf", scope: "project", origin: "top-level", baseDir: join(dir, name) }, disableModelInvocation: false });
	}
	return skills;
}
function parseFrontmatter(content: string): { name?: string; description?: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const body = match[1];
	const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim();
	const descBlock = body.match(/^description:\s*\|?\s*\n([\s\S]*?)(?=\n[a-zA-Z]|\n---|$)/m);
	const descInline = body.match(/^description:\s*(.+)$/m);
	return { name, description: (descBlock?.[1] ?? descInline?.[1] ?? "").split("\n").map((l) => l.replace(/^\s+/, "")).join(" ").trim() || undefined };
}

// ── init scaffold ────────────────────────────────────────────────────────

export const NF_RUN_DIR = "normal_run";
export function controllerInitScaffold(cwd: string, runDirName = NF_RUN_DIR): { created: string[]; skipped: string[] } {
	const dirs = [".xdd", ".xdd/design", ".xdd/design/spec", ".xdd/design/architecture", ".xdd/design/personas", ".xdd/design/wire", ".xdd/runs", `.xdd/runs/${runDirName}`, ".xdd/archive"];
	const created: string[] = []; const skipped: string[] = [];
	for (const d of dirs) { const abs = join(cwd, d); if (existsSync(abs)) skipped.push(d); else { mkdirSync(abs, { recursive: true }); created.push(d); } }
	for (const [path, content] of Object.entries(SCAFFOLD_READMES)) { const abs = join(cwd, path); if (existsSync(abs)) skipped.push(path); else { writeFileSync(abs, content, "utf8"); created.push(path); } }
	return { created, skipped };
}
const SCAFFOLD_READMES: Record<string, string> = {
	".xdd/design/README.md": "# Design workspace\n\nPersistent product-design artifacts.\n",
	".xdd/runs/README.md": "# Run workspace\n\nNF stores the active run's evidence under normal_run.\n",
	".xdd/archive/README.md": "# Archive workspace\n\nCompleted-run archives are stored here.\n",
};

// ── flow budget ──────────────────────────────────────────────────────────

export const DEFAULT_FLOW_BUDGET_USD = 500;
export function configuredFlowBudgetUsd(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.XDD_FLOW_BUDGET_USD;
	if (raw === undefined || raw.trim() === "") return DEFAULT_FLOW_BUDGET_USD;
	const v = Number(raw);
	if (!Number.isFinite(v) || v <= 0) throw new Error("XDD_FLOW_BUDGET_USD 必须是大于 0 的美元金额。");
	return v;
}
export function assistantFlowUsage(messages: readonly unknown[]): Array<{ timestamp: number; tokens: number; costUsd: number }> {
	return messages.flatMap((msg) => {
		if (!msg || typeof msg !== "object" || (msg as Record<string, unknown>).role !== "assistant") return [];
		const m = msg as Record<string, unknown>;
		const usage = m.usage as Record<string, unknown> | undefined;
		if (!usage || typeof usage !== "object") return [];
		const ts = typeof m.timestamp === "number" ? m.timestamp : NaN;
		const tokens = typeof usage.totalTokens === "number" ? usage.totalTokens : 0;
		const cost = usage.cost && typeof usage.cost === "object" ? (typeof (usage.cost as Record<string, unknown>).total === "number" ? (usage.cost as Record<string, unknown>).total as number : 0) : 0;
		return Number.isFinite(ts) ? [{ timestamp: ts, tokens, costUsd: cost }] : [];
	});
}

// ── archive ──────────────────────────────────────────────────────────────

export function archiveRun(cwd: string, runLabel?: string): void {
	const runsDir = join(cwd, ".xdd", "runs");
	const archiveDir = join(cwd, ".xdd", "archive");
	mkdirSync(archiveDir, { recursive: true });
	let source = runLabel ? join(runsDir, runLabel) : pickRecent(runsDir);
	if (!existsSync(source)) return;
	const sections: string[] = [`# NF Run Archive -- ${basename(source)}`, `> Generated ${new Date().toISOString()}.`, ""];
	const files = listFiles(source);
	if (files.length > 0) { sections.push("## Files"); for (const f of files.sort()) sections.push(`- \`${f}\` (${statSync(join(source, f)).size}B)`); sections.push(""); }
	writeFileSync(join(archiveDir, `${basename(source)}.md`), sections.join("\n"), "utf8");
	rmSync(source, { recursive: true, force: true });
}
function pickRecent(runsDir: string): string {
	const all = readdirSync(runsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
	if (all.length === 0) return join(runsDir, "normal_run");
	all.sort((a, b) => statSync(join(runsDir, b.name)).mtimeMs - statSync(join(runsDir, a.name)).mtimeMs);
	return join(runsDir, all[0].name);
}
function listFiles(dir: string, prefix = ""): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${e.name}` : e.name;
		if (e.isDirectory()) out.push(...listFiles(join(dir, e.name), rel));
		else out.push(rel);
	}
	return out;
}

// ── stage diff ───────────────────────────────────────────────────────────

export interface NfStageDifference {
	stageName: string;
	gate: NfGateResult;
	metCount: number;
	unmetCount: number;
	selfCheckCount: number;
	fsSnap: NfFsSnapshot;
}

export async function computeStageDifference(cwd: string, stage: NfStageSpec, ctx: { artifacts: string[] }): Promise<NfStageDifference> {
	const fsSnap = observeFilesystem(cwd, stage.deliverablePaths);
	const gate = await stage.gate({ cwd, summary: ctx.artifacts.join(", "), desiredState: stage.desiredState });
	let met = 0, unmet = 0, selfCheck = 0;
	for (const item of stage.desiredState) {
		if (item.includes("产出") || item.includes("创建") || item.includes("生成") || item.includes("删除") || item.includes("更新")) {
			if (fsSnap.deliverables.length === 0) { selfCheck++; continue; }
			if (fsSnap.deliverables.some((d) => d.exists && d.bytes > 0)) met++; else unmet++;
		} else selfCheck++;
	}
	return { stageName: stage.name, gate, metCount: met, unmetCount: unmet, selfCheckCount: selfCheck, fsSnap };
}

export function renderStageDifference(diff: NfStageDifference, opts?: { artifacts?: string[]; selfHealRemaining?: number; maxSelfHeal?: number }): string {
	const lines = [`阶段: ${diff.stageName}`, `硬 Gate: ${diff.gate.ok ? "通过" : "未通过"}`, `Desired State: ${diff.metCount}/${diff.metCount + diff.unmetCount + diff.selfCheckCount} 已满足（${diff.selfCheckCount} 项需自检）`];
	if (opts?.artifacts?.length) lines.push(`已提交产物: ${opts.artifacts.join(", ")}`);
	if (opts && opts.selfHealRemaining !== undefined && opts.maxSelfHeal !== undefined) lines.push(`自愈预算剩余: ${opts.selfHealRemaining}/${opts.maxSelfHeal}`);
	if (!diff.gate.ok) lines.push("", "Gate 失败原因:", `  ${diff.gate.reason ?? "未知"}`);
	if (diff.gate.ok) lines.push("", "可调用 nf_submit_artifact 提交。");
	return lines.join("\n");
}
