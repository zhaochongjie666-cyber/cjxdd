import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { XddBlindJourneyResult, XddBlindJourneyVerdict, XddBlindJourneySeverity } from "../types.ts";
import { type EmptyDetails, type GetXddState, ok } from "./index.ts";
import {
	parseFeatureFile,
	findScenario,
	buildActorPrompt,
	buildJudgePrompt,
	buildSituation,
	buildGoal,
	journeyReportPath,
	resultsFilePath,
	coverageReportPath,
	createReportSkeleton,
	recordResult,
	readResults,
	generateCoverageReport,
	computeOverallVerdict,
} from "../blind-journey.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const schema = Type.Object({
	action: Type.Union(
		[
			Type.Literal("prepare_actor"),
			Type.Literal("prepare_judge"),
			Type.Literal("record"),
			Type.Literal("coverage"),
		],
		{ description: "prepare_actor: 生成盲测 Actor 提示词（剥离 Then）。prepare_judge: 生成裁判提示词（完整 Feature）。record: 记录验收结果。coverage: 生成覆盖率报告。" },
	),
	featurePath: Type.Optional(Type.String({ description: ".feature 文件路径（prepare_actor/prepare_judge 用）" })),
	scenarioId: Type.Optional(Type.String({ description: "场景 ID（@AC-01 标签或场景名，prepare_actor/prepare_judge/record 用）" })),
	roleId: Type.Optional(Type.String({ description: "角色 ID（如 project_admin）" })),
	roleName: Type.Optional(Type.String({ description: "角色名称（如 项目管理员）" })),
	roleDef: Type.Optional(Type.String({ description: "角色定义全文（prepare_actor 用，含身份/权限/业务目标/未知知识）" })),
	entryUrl: Type.Optional(Type.String({ description: "产品入口地址（prepare_actor 用）" })),
	credentialRef: Type.Optional(Type.String({ description: "登录凭据引用（prepare_actor 用，如 secret://blind/project-admin-01）" })),
	journeyReportPath: Type.Optional(Type.String({ description: "Actor 旅途报告路径（prepare_judge 用）" })),
	verdict: Type.Optional(
		Type.Union(
			[
				Type.Literal("PASS"),
				Type.Literal("PASS_WITH_FRICTION"),
				Type.Literal("FAIL"),
				Type.Literal("BLOCKED"),
				Type.Literal("INCONCLUSIVE"),
			],
			{ description: "验收结论（record 用）" },
		),
	),
	severity: Type.Optional(
		Type.Union(
			[Type.Literal("P0"), Type.Literal("P1"), Type.Literal("P2"), Type.Literal("P3"), Type.Literal("P4")],
			{ description: "最高问题等级（record 用）" },
		),
	),
	confidence: Type.Optional(
		Type.Union([Type.Literal("High"), Type.Literal("Medium"), Type.Literal("Low")], { description: "判断置信度（record 用）" }),
	),
	issues: Type.Optional(
		Type.Array(
			Type.Object({
				id: Type.String(),
				severity: Type.Union([Type.Literal("P0"), Type.Literal("P1"), Type.Literal("P2"), Type.Literal("P3"), Type.Literal("P4")]),
				location: Type.String(),
				expected: Type.String(),
				actual: Type.String(),
				impact: Type.String(),
				evidence: Type.Array(Type.String()),
			}),
		),
		{ description: "体验问题列表（record 用）" },
	),
	evidencePaths: Type.Optional(Type.Array(Type.String()), { description: "证据文件路径列表（record 用）" }),
	reportPath: Type.Optional(Type.String(), { description: "报告文件路径（record 用）" }),
});

export type XddBlindJourneyInput = Static<typeof schema>;

/**
 * xdd_blind_journey: Blind Journey black-box user acceptance tool.
 *
 * Two-phase isolation:
 * 1. prepare_actor: Strips Then clauses from the Feature, outputs a prompt
 *    with only role + situation + goal. The agent follows this prompt to
 *    navigate the product via browser (no code/API/DOM access).
 * 2. prepare_judge: Outputs a prompt with the FULL Feature + actor's evidence.
 *    The agent evaluates whether the journey meets acceptance criteria.
 *
 * The tool also records structured results and generates coverage reports.
 */
export function createXddBlindJourneyTool(getState: GetXddState): ToolDefinition {
	return {
		name: "xdd_blind_journey",
		label: "xdd: blind journey validation",
		description:
			"盲测用户验收：prepare_actor 生成剥离 Then 的 Actor 提示词（角色+目标，不知预期结果），prepare_judge 生成完整 Feature 裁判提示词，record 记录验收结论，coverage 生成角色覆盖报告。verify 阶段用。",
		parameters: schema,
		async execute(_toolCallId, params: XddBlindJourneyInput): Promise<AgentToolResult<EmptyDetails>> {
			const state = getState();
			const cwd = state.cwd;

			switch (params.action) {
				// ── Phase 1: Journey Actor ───────────────────────────────
				case "prepare_actor": {
					if (!params.featurePath || !params.scenarioId || !params.roleId || !params.roleDef || !params.entryUrl) {
						throw new Error(
							"[xdd_blind_journey] prepare_actor 需要: featurePath, scenarioId, roleId, roleDef, entryUrl",
						);
					}
					const absFeature = join(cwd, params.featurePath);
					if (!existsSync(absFeature)) {
						throw new Error(`[xdd_blind_journey] Feature 文件不存在: ${params.featurePath}`);
					}
					const { scenarios } = parseFeatureFile(absFeature);
					const scenario = findScenario(scenarios, params.scenarioId);
					if (!scenario) {
						throw new Error(
							`[xdd_blind_journey] 未找到场景: ${params.scenarioId}（在 ${params.featurePath}）。可用场景: ${scenarios.map((s) => s.scenarioName).join(", ")}`,
						);
					}

					const situation = buildSituation(scenario.given);
					const goal = buildGoal(scenario.when);
					const rptPath = journeyReportPath(cwd, params.roleId, params.scenarioId);
					createReportSkeleton(rptPath, params.roleDef, situation, goal);

					const prompt = buildActorPrompt({
						roleDef: params.roleDef,
						situation,
						goal,
						entryUrl: params.entryUrl,
						credentialRef: params.credentialRef,
						reportPath: rptPath,
					});

					return ok(
						`[Blind Journey Actor] 场景 ${params.scenarioId} / 角色 ${params.roleId}\n` +
							`报告骨架已创建: ${rptPath}\n\n` +
							`=== Actor 提示词（不含 Then，不提前知道预期结果）===\n\n${prompt}`,
					);
				}

				// ── Phase 2: Acceptance Judge ────────────────────────────
				case "prepare_judge": {
					if (!params.featurePath || !params.scenarioId || !params.journeyReportPath) {
						throw new Error(
							"[xdd_blind_journey] prepare_judge 需要: featurePath, scenarioId, journeyReportPath",
						);
					}
					const absFeature = join(cwd, params.featurePath);
					if (!existsSync(absFeature)) {
						throw new Error(`[xdd_blind_journey] Feature 文件不存在: ${params.featurePath}`);
					}
					const absJourney = existsSync(params.journeyReportPath)
						? params.journeyReportPath
						: join(cwd, params.journeyReportPath);
					if (!existsSync(absJourney)) {
						throw new Error(`[xdd_blind_journey] Actor 旅途报告不存在: ${params.journeyReportPath}`);
					}

					const featureContent = readFileSync(absFeature, "utf8");
					const rptPath = absJourney.replace(/\.md$/, "-judge.md");
					const prompt = buildJudgePrompt({
						featureContent,
						journeyReportPath: absJourney,
						resultReportPath: rptPath,
					});

					return ok(
						`[Blind Journey Judge] 场景 ${params.scenarioId}\n` +
							`裁判报告将写入: ${rptPath}\n\n` +
							`=== Judge 提示词（含完整 Feature + 证据）===\n\n${prompt}`,
					);
				}

				// ── Record result ─────────────────────────────────────────
				case "record": {
					if (!params.scenarioId || !params.roleId || !params.verdict) {
						throw new Error("[xdd_blind_journey] record 需要: scenarioId, roleId, verdict");
					}
					const result: XddBlindJourneyResult = {
						scenarioId: params.scenarioId,
						featurePath: params.featurePath ?? "",
						roleId: params.roleId,
						roleName: params.roleName ?? params.roleId,
						verdict: params.verdict as XddBlindJourneyVerdict,
						severity: (params.severity as XddBlindJourneySeverity | undefined) ?? null,
						confidence: (params.confidence as "High" | "Medium" | "Low") ?? "Medium",
						issues: (params.issues ?? []).map((i) => ({
							...i,
							role: params.roleId!,
							severity: i.severity as XddBlindJourneySeverity,
						})),
						evidencePaths: params.evidencePaths ?? [],
						reportPath: params.reportPath ?? "",
						at: new Date().toISOString(),
					};
					recordResult(cwd, result);
					const overall = computeOverallVerdict(cwd);
					state.blindJourneyVerdict = overall;

					return ok(
						`[Blind Journey] 结果已记录: ${params.roleId}/${params.scenarioId} = ${params.verdict}\n` +
							`总体验收: ${overall}\n` +
							`结果文件: ${resultsFilePath(cwd)}`,
					);
				}

				// ── Coverage report ───────────────────────────────────────
				case "coverage": {
					const report = generateCoverageReport(cwd);
					const overall = computeOverallVerdict(cwd);
					state.blindJourneyVerdict = overall;
					const results = readResults(cwd);
					return ok(
						`[Blind Journey Coverage] ${results.length} 个场景已验收\n` +
							`总体结论: ${overall}\n` +
							`报告已写入: ${coverageReportPath(cwd)}\n\n${report}`,
					);
				}

				default:
					throw new Error(`[xdd_blind_journey] 未知 action: ${params.action}`);
			}
		},
	};
}
