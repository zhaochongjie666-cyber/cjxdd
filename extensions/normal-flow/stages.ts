/**
 * Normal Flow 的四阶段正向入口：完整设计链 → 搭框架 → TDD 完成全部 Scenario → 攻击验证。
 * 刻意不设置 plan/execute 阶段；design 在一个阶段内生成与 xdd 同形的持久设计产物。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireGlobs, requireGlobsWithMinSize, requireTestsPass, runBuild, gitHasChanges } from "./gate.ts";
import { buildTraceCoverage, observeFilesystem } from "./observe-fs.ts";
import { globToRegExp, hasGlobMeta, walkRel } from "./gate.ts";
import { STAGE_ROLES } from "./types.ts";
import type { NfArtifactRule, NfGate, NfStageName, NfStageSpec } from "./types.ts";

const roleFor = (name: NfStageName): string => STAGE_ROLES[name];
export const NF_CONTROLLER_TOOLS = ["nf_observe", "nf_desired_state", "nf_difference", "nf_submit_artifact", "nf_advance", "nf_rollback"] as const;
export const READ_TOOLS = ["read", "grep", "find", "ls"] as const;
export const WRITE_TOOLS = ["write", "edit"] as const;
const input = (pattern: string, description: string): NfArtifactRule => ({ pattern, required: true, description });
const output = (pattern: string, description: string): NfArtifactRule => ({ pattern, required: true, description });

type NfLocalStageName = "understand" | "architecture" | "spec" | "verify";
interface NfContractMeta {
	inputs: NfArtifactRule[];
	readScopes: string[];
	writeScopes: string[];
	rollbackTarget: NfStageName | "none";
}
const NF_CONTRACT_META: Record<NfLocalStageName, NfContractMeta> = {
	understand: {
		inputs: [input("README*", "仓库说明与用户需求（如存在）")],
		readScopes: ["**"],
		writeScopes: [".xdd/design/**", ".xdd/runs/normal_run/**"],
		rollbackTarget: "none",
	},
	architecture: {
		inputs: [input(".xdd/design/**", "完整设计链")],
		readScopes: ["**"],
		writeScopes: ["**"],
		rollbackTarget: "understand",
	},
	spec: {
		inputs: [input(".xdd/design/**", "场景实现所依据的完整设计链")],
		readScopes: ["**"],
		writeScopes: ["**"],
		rollbackTarget: "architecture",
	},
	verify: {
		inputs: [input(".xdd/design/spec/**", "已实现的业务场景与规则")],
		readScopes: ["**"],
		writeScopes: [".xdd/runs/normal_run/*.md"],
		rollbackTarget: "spec",
	},
};
const NF_NO_AIGATE_STANDARD = "NF 不启用 AIGate；以架构框架、逐 Scenario TDD 证据和最终攻击验证的硬 Gate 闭环。";

function matchingFiles(cwd: string, patterns: readonly string[]): string[] {
	let walked: string[] | undefined;
	const out = new Set<string>();
	for (const pattern of patterns) {
		if (!hasGlobMeta(pattern)) { out.add(pattern); continue; }
		walked ??= walkRel(cwd);
		const re = globToRegExp(pattern);
		for (const file of walked) if (re.test(file.replace(/\\/g, "/"))) out.add(file);
	}
	return [...out];
}
function readMatchedText(cwd: string, patterns: readonly string[]): string {
	return matchingFiles(cwd, patterns).map((rel) => {
		try { return readFileSync(join(cwd, rel), "utf8"); } catch { return ""; }
	}).join("\n");
}
function withNfStageContract(stage: NfStageSpec): NfStageSpec {
	const meta = NF_CONTRACT_META[stage.name as NfLocalStageName];
	if (!meta) throw new Error(`[normal-flow] stage ${stage.name} 缺少 NF_CONTRACT_META 条目`);
	return {
		...stage,
		inputs: meta.inputs,
		outputs: stage.deliverablePaths.map((pattern) => output(pattern, `${stage.name} 必需产物 ${pattern}`)),
		readScopes: meta.readScopes,
		writeScopes: meta.writeScopes,
		gatePolicy: "hard",
		hardGate: stage.gate,
		rollbackPolicy: { target: meta.rollbackTarget, reason: meta.rollbackTarget === "none" ? "design 是首阶段" : `${stage.name} 默认回退到 ${meta.rollbackTarget}` },
	};
}

const designGate: NfGate = async ({ cwd }) => {
	const checks: Array<[string[], string]> = [
		[[".xdd/design/intent.md", ".xdd/design/design.md", ".xdd/design/personas/_index.md"], "需求意图、收敛决策或角色设计"],
		[[".xdd/design/business-process.md"], "用户与管理员端到端业务流程"],
		[[".xdd/design/experience.md"], "用户体验与前端视觉设计"],
		[[".xdd/design/operations.md"], "运维监控、诊断与人工/AI 接管设计"],
		[[".xdd/design/test-environment.md"], "Docker 测试环境、数据库与依赖准备设计"],
		[[".xdd/design/spec/**/rules.md", ".xdd/design/spec/**/*.feature"], "RXX 规则或 Gherkin Scenario"],
		[[".xdd/design/architecture/**/architecture.md", ".xdd/design/architecture/module-landscape.md", ".xdd/design/architecture/event-contract.md", ".xdd/design/architecture/aggregate-landscape.md"], "架构、模块、事件或聚合设计"],
		[[".xdd/design/architecture/performance.md"], "性能目标、容量模型与性能验证设计"],
		[[".xdd/design/wire/*.md"], "交互线框与操作状态设计"],
		[[".xdd/design/architecture/**/resilience/failure-modes.md", ".xdd/design/architecture/**/resilience/failsafe-design.md", ".xdd/design/architecture/**/resilience/resilience-test-plan.md"], "失败模式、兜底或韧性测试设计"],
	];
	for (const [patterns, label] of checks) {
		for (const pattern of patterns) {
			const result = await requireGlobs(cwd, [pattern]);
			if (!result.ok) return { ok: false, reason: `design Gate: 缺少${label}；请按 understand→spec→architecture→wire→resilience 的正向顺序补齐：${pattern}` };
		}
	}
	const personaFiles = matchingFiles(cwd, [".xdd/design/personas/*.md"])
		.filter((path) => !path.endsWith("/_index.md"));
	if (personaFiles.length === 0) return { ok: false, reason: "design Gate: personas 只有索引而没有角色档案；请按 xdd understand 正向动作补至少一个具体角色的深度档案" };
	const designDimensions: Array<[string, RegExp, string]> = [
		[".xdd/design/business-process.md", /用户|customer|user/i, "用户目标与旅程"],
		[".xdd/design/business-process.md", /管理员|admin/i, "管理员流程与权限"],
		[".xdd/design/experience.md", /页面|视觉|布局|交互|frontend|UI/i, "页面视觉与交互状态"],
		[".xdd/design/operations.md", /监控|指标|日志|trace|告警/i, "监控与可观测性"],
		[".xdd/design/operations.md", /debug|诊断|排障|runbook/i, "高效诊断与排障路径"],
		[".xdd/design/operations.md", /人工|AI|接管|handoff/i, "人工或 AI 运维接管边界"],
		[".xdd/design/architecture/performance.md", /性能|延迟|吞吐|并发|容量|SLO/i, "可度量的性能要求"],
		[".xdd/design/test-environment.md", /Docker|container|compose/i, "容器化测试拓扑"],
		[".xdd/design/test-environment.md", /数据库|database|postgres|mysql|mongo|redis|无需数据库/i, "测试数据库与依赖决策"],
		[".xdd/design/test-environment.md", /migration|迁移|seed|种子|fixture/i, "数据库初始化与测试数据"],
		[".xdd/design/test-environment.md", /health|健康|ready|就绪|wait/i, "依赖就绪检查"],
		[".xdd/design/test-environment.md", /隔离|清理|reset|volume|独立/i, "测试隔离与清理策略"],
	];
	for (const [path, pattern, label] of designDimensions) {
		const substantial = await requireGlobsWithMinSize(cwd, [path], 100);
		if (!substantial.ok || !pattern.test(readMatchedText(cwd, [path]))) {
			return { ok: false, reason: `design Gate: ${path} 缺少可执行的${label}；请先完成对应正向设计，不得带着设计缺口进入代码实现` };
		}
	}

	// 攻击检查 1: .feature 必须包含兜底场景（失败/拒绝/无权限/边界），不能只有 happy path
	const featureText = readMatchedText(cwd, [".xdd/design/spec/**/*.feature"]);
	if (featureText && !/失败|拒绝|无权限|未授权|边界|invalid|unauthorized|forbidden|denied|error|conflict|不存在|超时|timeout|exceed|limit/i.test(featureText)) {
		return { ok: false, reason: "design Gate: .feature 只有正向场景，缺少兜底场景（失败/拒绝/无权限/边界）；正向和兜底都要设计" };
	}

	// 攻击检查 2: resilience 文件必须有实质内容（不只是存在）
	const resilienceText = readMatchedText(cwd, [".xdd/design/architecture/**/resilience/failure-modes.md"]);
	if (resilienceText && resilienceText.length < 200) {
		return { ok: false, reason: "design Gate: failure-modes.md 内容过短（<200 字节），缺少实质的失败模式分析" };
	}
	const failsafeText = readMatchedText(cwd, [".xdd/design/architecture/**/resilience/failsafe-design.md"]);
	if (failsafeText && failsafeText.length < 200) {
		return { ok: false, reason: "design Gate: failsafe-design.md 内容过短（<200 字节），缺少实质的兜底设计" };
	}

	return { ok: true };
};

const frameworkGate: NfGate = async ({ cwd }) => {
	const doc = await requireGlobsWithMinSize(cwd, [".xdd/design/architecture/**/architecture.md"], 100);
	if (!doc.ok) return { ok: false, reason: "framework Gate: 完整设计链中的 architecture.md 缺失或过短；请先回 design 补齐，再按其端点搭建框架" };
	const frameworkChecks = await Promise.all(["src/**/*", "lib/**/*", "app/**/*", "cmd/**/*"].map((pattern) => requireGlobs(cwd, [pattern])));
	if (!frameworkChecks.some((result) => result.ok)) return { ok: false, reason: "framework Gate: 架构文档已有，但缺少 src/lib/app/cmd 任一惯用目录中的代码框架；请回到正向动作搭建架构端点" };
	const dockerfile = await requireGlobsWithMinSize(cwd, ["Dockerfile.test"], 50);
	if (!dockerfile.ok) return { ok: false, reason: "framework Gate: 缺少可复现的 Dockerfile.test；请按 test-environment.md 封装测试运行时、依赖安装与测试入口" };
	const compose = await requireGlobsWithMinSize(cwd, ["compose.test.yaml"], 100);
	if (!compose.ok) return { ok: false, reason: "framework Gate: 缺少 compose.test.yaml；请声明 test 服务、数据库/外部依赖、healthcheck 和隔离 volume/network" };
	const composeText = readMatchedText(cwd, ["compose.test.yaml"]);
	const composeRequirements: Array<[RegExp, string]> = [
		[/services\s*:/i, "services"], [/test\s*:/i, "test runner 服务"],
		[/healthcheck\s*:/i, "数据库或依赖 healthcheck"], [/depends_on\s*:/i, "依赖就绪关系"],
	];
	for (const [pattern, label] of composeRequirements) {
		if (!pattern.test(composeText)) return { ok: false, reason: `framework Gate: compose.test.yaml 缺少 ${label}；请回到 Docker 测试环境正向动作补齐` };
	}
	const testScript = await requireGlobsWithMinSize(cwd, ["scripts/test-in-docker"], 30);

	// 攻击检查: 框架必须能编译（不能是只有空目录）
	const build = await runBuild(cwd);
	if (!build.ok && build.reason) return { ok: false, reason: `framework Gate: 框架代码编译失败 -- ${build.reason}；请确保框架有真实的入口文件和依赖声明，不是空目录` };

	if (!testScript.ok) return { ok: false, reason: "framework Gate: 缺少 scripts/test-in-docker；请提供一条可重复启动依赖、执行测试并清理环境的入口" };
	return { ok: true };
};

const scenariosGate: NfGate = async ({ cwd }) => {
	const rules = await requireGlobsWithMinSize(cwd, [".xdd/design/spec/**/rules.md"], 100);
	if (!rules.ok) return { ok: false, reason: "scenarios Gate: 缺少规则锚；请从架构能力提取 RXX 并写入 rules.md" };
	const features = await requireGlobs(cwd, [".xdd/design/spec/**/*.feature"]);
	if (!features.ok) return { ok: false, reason: "scenarios Gate: 缺少 .feature；请列出全部正向与兜底 Scenario" };
	const coverage = buildTraceCoverage(observeFilesystem(cwd, []));
	if (coverage.specRxx.length === 0) return { ok: false, reason: "scenarios Gate: 未发现 RXX；请为 Scenario 建立可追溯规则锚" };
	const text = readMatchedText(cwd, [".xdd/design/spec/**/rules.md", ".xdd/design/spec/**/*.feature"]);
	if (!/(@covers-)?(?:B\d{2}-)?R\d{2}/.test(text)) return { ok: false, reason: "scenarios Gate: Scenario 未绑定 RXX" };
	if (coverage.unimplemented.length > 0) return { ok: false, reason: `scenarios Gate: 以下规则尚未完成红→绿 TDD 或缺少 @implements：${coverage.unimplemented.join(", ")}` };

	// 攻击检查 1: .feature 必须包含兜底场景，不能只有 happy path
	if (!/失败|拒绝|无权限|未授权|边界|invalid|unauthorized|forbidden|denied|error|conflict|不存在|超时|timeout|exceed|limit/i.test(text)) {
		return { ok: false, reason: "scenarios Gate: .feature 只有正向场景，缺少兜底场景（失败/拒绝/无权限/边界）；每个 Feature 都要有正向和兜底 Scenario" };
	}

	// 攻击检查 2: 构建必须通过（代码能编译）
	const build = await runBuild(cwd);
	if (!build.ok) return { ok: false, reason: `scenarios Gate: 构建失败 -- ${build.reason}` };

	const tests = await requireTestsPass(cwd);
	if (!tests.ok) return { ok: false, reason: `scenarios Gate: 测试未通过；回到对应 Scenario 的失败测试并完成最小实现。${tests.reason ?? ""}` };
	return { ok: true };
};

const verifyGate: NfGate = async ({ cwd }) => {
	// 1. 构建必须通过（代码能编译）
	const build = await runBuild(cwd);
	if (!build.ok) return { ok: false, reason: `verify Gate: 构建失败 -- ${build.reason}` };

	// 2. 测试必须通过
	const tests = await requireTestsPass(cwd);
	if (!tests.ok) return tests;

	// 3. Git 必须有代码改动（有真实实现，不是只写了文档）
	const git = await gitHasChanges(cwd);
	if (!git.ok) return { ok: false, reason: `verify Gate: ${git.reason}` };

	// 4. P0 硬检查：所有 Scenario 必须已实现（有 Scenario 没做 = P0 = 必须回 scenarios 重做）
	const coverage = buildTraceCoverage(observeFilesystem(cwd, []));
	if (coverage.specRxx.length === 0) return { ok: false, reason: "P0: spec 中无 RXX 规则，即所有 Scenario 未实现；请回 scenarios 阶段补业务规则并实现" };
	if (coverage.unimplemented.length > 0) return { ok: false, reason: `P0: 有 Scenario 未实现（${coverage.unimplemented.join(", ")}）；未实现的 Scenario 就是 P0，必须回 scenarios 重做，不能带病通过` };
	if (coverage.orphan.length > 0) return { ok: false, reason: `verify Gate: 代码中有无 spec 对应的 @implements（孤儿: ${coverage.orphan.join(", ")}）；请补 spec 或删除标注` };

	// 5. verify-report.md 必须存在且内容充实（至少 1000 字节）
	const report = await requireGlobsWithMinSize(cwd, [".xdd/runs/normal_run/verify-report.md"], 1000);
	if (!report.ok) return { ok: false, reason: "verify Gate: 缺少 verify-report.md（至少 1000 字节，须含真实执行证据而非关键词）" };
	const reportText = readMatchedText(cwd, [".xdd/runs/normal_run/verify-report.md"]);

	// 6. 报告必须包含真实测试通过证据（exit code / PASS，不只是提到测试）
	if (!/exit\s*code\s*[:=]?\s*0|✅|PASS|测试通过|tests?\s+passed/i.test(reportText)) {
		return { ok: false, reason: "verify Gate: verify-report.md 缺少测试通过证据（exit code 0 / PASS / 测试通过）；请记录真实执行结果，不要只写关键词" };
	}

	// 7. 报告必须记录 Docker 一键测试的执行输出
	if (!/scripts\/test-in-docker|docker\s+compose/i.test(reportText)) {
		return { ok: false, reason: "verify Gate: verify-report.md 缺少 Docker 一键测试执行记录；请从干净容器环境重跑并粘贴输出" };
	}

	// 8. 报告必须记录数据库初始化/隔离证据
	if (!/数据库|database|migration|seed|无需数据库/i.test(reportText)) {
		return { ok: false, reason: "verify Gate: verify-report.md 缺少测试数据库初始化/隔离证据或无需数据库的明确说明" };
	}

	// 9. 报告必须记录攻击/兜底验证（不只是 happy path）
	if (!/攻击|attack|逆向|reverse|兜底|fallback|失败|fail|边界|edge|拒绝|deny/i.test(reportText)) {
		return { ok: false, reason: "verify Gate: verify-report.md 缺少攻击/兜底/失败路径验证记录；verify 不是只跑 happy path" };
	}

	// 9.5 报告必须记录端到端用户旅程验证（从不同角色视角验收，不是只跑单元测试）
	if (!/角色|用户.*视角|管理员|普通用户|端到端|end.?to.?end|用户旅程|user.?journey|browser|浏览器|curl|HTTP/i.test(reportText)) {
		return { ok: false, reason: "verify Gate: verify-report.md 缺少端到端用户旅程验证记录；须从不同用户角色视角通过 HTTP/浏览器验收每个 Feature，不是只跑单元测试" };
	}

	// 10. operations-handoff.md 必须存在且内容充实（至少 500 字节）
	const handoff = await requireGlobsWithMinSize(cwd, [".xdd/runs/normal_run/operations-handoff.md"], 500);
	if (!handoff.ok) return { ok: false, reason: "verify Gate: 缺少 operations-handoff.md（至少 500 字节）；请记录部署、监控、告警、debug/runbook、回滚及人工/AI 运维接管方式" };

	// 11. 必须有截图证据（实际文件存在，不是文字声称）
	const screenshots = matchingFiles(cwd, [".xdd/runs/normal_run/screenshots/*.png", ".xdd/runs/normal_run/screenshots/*.jpg", ".xdd/runs/normal_run/screenshots/*.webp", ".xdd/runs/normal_run/*.png", ".xdd/runs/normal_run/*.jpg"]);
	if (screenshots.length === 0) {
		return { ok: false, reason: "verify Gate: 缺少截图证据；每个用户旅程必须有实际截图文件（.png/.jpg/.webp），放在 .xdd/runs/normal_run/screenshots/ 下。没有截图 = 没验证" };
	}

	// 13. 报告必须明确声明 P1=0
	if (!/P1.*[:：]\s*0|P1.*无|无\s*P1|P1.*0\s*个|0\s*个\s*P1|P1.*未发现|P1.*零/i.test(reportText)) {
		return { ok: false, reason: "verify Gate: verify-report.md 未明确声明 P1=0；有 P1 问题必须回 scenarios 修复后重交" };
	}

	// 14. 报告必须明确声明 P2=0
	if (!/P2.*[:：]\s*0|P2.*无|无\s*P2|P2.*0\s*个|0\s*个\s*P2|P2.*未发现|P2.*零/i.test(reportText)) {
		return { ok: false, reason: "verify Gate: verify-report.md 未明确声明 P2=0；有 P2 问题必须修复后重交" };
	}

	// 15. 报告不能有未通过的用户旅途（走不通 = P0 = 必须回炉）
	if (/旅途.*失败|journey.*fail|用户.*走不通|无法完成|未通过.*旅途|旅途.*未通过|旅途.*阻塞|journey.*blocked/i.test(reportText)) {
		return { ok: false, reason: "verify Gate: verify-report.md 记录了未通过的用户旅途；用户旅途走不通是 P0 问题，必须回 scenarios 重做，不能带病通过" };
	}


	return { ok: true };
};

export const NF_STAGES: readonly NfStageSpec[] = [
	{
		name: "understand", role: roleFor("understand"), skill: "xdd-brainstorm", exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已把用户希望获得的结果、端到端业务流程与体验旅程设计清楚，而不是让代码实现反推产品需求",
			"已设计前端页面的信息层级、视觉方向、组件和空/加载/错误/成功/确认/边界状态，明确什么叫好看且可用",
			"已设计管理员的审核、配置、权限、异常处理和审计流程",
			"已定义架构约束与可度量的性能预算、容量假设、降级策略和验证方法",
			"已设计运维工程师的指标、日志、trace、告警、debug/runbook、回滚，以及人工或 AI 接管边界",
			"已设计 Docker 测试拓扑、测试数据库和外部依赖、migration/seed、healthcheck、隔离清理与一键执行方式",
			"需求层已完成 intent.md、design.md 与 personas；规格层已完成 RXX rules.md 与全部正向/兜底 Feature Scenario",
			"架构层已完成各业务 architecture.md、module-landscape.md、event-contract.md 与 aggregate-landscape.md",
			"交互层已完成 wire 页面及空/加载/错误/成功/确认/边界状态；韧性层已完成 failure-modes、failsafe-design 与 resilience-test-plan",
			"各层通过 RXX 保持追溯，正向设计和失败兜底均可供后续 framework/scenarios 直接消费",
		],
		deliverablePaths: [
			".xdd/design/intent.md", ".xdd/design/design.md", ".xdd/design/personas/_index.md",
			".xdd/design/business-process.md", ".xdd/design/experience.md", ".xdd/design/operations.md", ".xdd/design/test-environment.md",
			".xdd/design/spec/**/rules.md", ".xdd/design/spec/**/*.feature",
			".xdd/design/architecture/**/architecture.md", ".xdd/design/architecture/module-landscape.md",
			".xdd/design/architecture/event-contract.md", ".xdd/design/architecture/aggregate-landscape.md", ".xdd/design/architecture/performance.md",
			".xdd/design/wire/*.md", ".xdd/design/architecture/**/resilience/failure-modes.md",
			".xdd/design/architecture/**/resilience/failsafe-design.md", ".xdd/design/architecture/**/resilience/resilience-test-plan.md",
		],
		aigateStandard: NF_NO_AIGATE_STANDARD, gate: designGate, noCodeReading: true,
	},
	{
		name: "architecture", role: roleFor("architecture"), skill: "xdd-architecture", exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, "bash", ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已读取 design 阶段的 intent/spec/architecture/wire/resilience 完整设计链",
			"已按完整架构文档搭出可运行的代码框架，而不是重写设计或补计划",
			"框架包含后续 Scenario 所需的端点与测试接缝，并完成最小启动/编译自检",
			"已按 test-environment.md 生成 Dockerfile.test、compose.test.yaml 与 scripts/test-in-docker，数据库/依赖具备 healthcheck、migration/seed 和隔离清理",
		],
		deliverablePaths: ["Dockerfile.test", "compose.test.yaml", "scripts/test-in-docker"], aigateStandard: NF_NO_AIGATE_STANDARD, gate: frameworkGate,
	},
	{
		name: "spec", role: roleFor("spec"), skill: "xdd-execute", exit: "goal_complete",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, "bash", ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已从需求与架构能力列全 RXX 和 Gherkin Scenario，正向与失败/拒绝/冲突/无权限/边界兜底都不遗漏",
			"已按 Scenario 逐个执行红→绿→重构：先看到失败测试，再写最小实现，再跑回归",
			"测试通过 scripts/test-in-docker 在隔离容器中运行，真实使用已准备的测试数据库和外部依赖，而不是依赖开发机偶然状态",
			"每条 RXX 都有测试证据和源码 @implements RXX，全部 Scenario 测试通过",
			"失败 Gate 能指出具体 RXX/Scenario，并直接给出回炉动作，而不是要求补 plan",
		],
		deliverablePaths: [".xdd/design/spec/**/rules.md", ".xdd/design/spec/**/*.feature"], aigateStandard: NF_NO_AIGATE_STANDARD, gate: scenariosGate,
	},
	{
		name: "verify", role: roleFor("verify"), skill: "xdd-verify", exit: "verdict",
		allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, "bash", ...NF_CONTROLLER_TOOLS],
		desiredState: [
			"已确保所有 Feature（Scenario）都有真实实现代码，不是桩/占位/注释；构建通过、单元/集成测试通过",
			"已从不同用户角色（如管理员/普通用户/审批者）视角，通过 HTTP 端点或浏览器端到端验证每个 Feature 场景的正向路径",
			"已端到端验证兜底路径：拒绝/失败/无权限/冲突/边界，每个都有真实执行证据",
			"每个用户旅程都有截图证据（.png/.jpg），放在 .xdd/runs/normal_run/screenshots/ 下；没有截图 = 没验证",
			"verify-report.md 记录每个角色的用户旅程、命令输出、截图引用、P0/P1/P2 问题清单",
			"P0 = 有 Scenario 没做（trace coverage 硬检查）；P1/P2 由报告声明，必须为 0；有任何未解决问题必须回 scenarios 重做，不能带病通过",
			"所有用户旅途必须走通；走不通 = P0 = 必须回炉重做",
			"已从干净环境执行 scripts/test-in-docker，验证镜像构建、依赖 healthcheck、migration/seed、数据库隔离和失败清理",
			"operations-handoff.md 已把部署、可观测性、告警、debug/runbook、回滚和人工/AI 接管方式交付清楚",
			"实现问题可回 scenarios 继续 TDD；架构问题可回 framework 重搭框架",
		],
		deliverablePaths: [".xdd/runs/normal_run/verify-report.md", ".xdd/runs/normal_run/operations-handoff.md", ".xdd/runs/normal_run/screenshots/"], aigateStandard: NF_NO_AIGATE_STANDARD, gate: verifyGate,
	},
].map(withNfStageContract);
