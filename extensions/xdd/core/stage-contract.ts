import { matchesGlob } from "../glob-resolver.ts";
import type { XddStageName, XddStageSpec } from "../types.ts";

export interface StageContractViolation {
	stage: XddStageName | string;
	field: string;
	pattern?: string;
	message: string;
	remediation: string;
}

export class StageContractError extends Error {
	readonly violations: readonly StageContractViolation[];

	constructor(violations: readonly StageContractViolation[]) {
		super(formatStageContractViolations(violations));
		this.name = "StageContractError";
		this.violations = violations;
	}
}

export function formatStageContractViolations(violations: readonly StageContractViolation[]): string {
	return [
		`[xdd] StageContract 编译失败：${violations.length} 个问题`,
		...violations.map((v) => {
			const pattern = v.pattern ? ` pattern=${v.pattern}` : "";
			return `- stage=${v.stage} field=${v.field}${pattern}: ${v.message}；修复：${v.remediation}`;
		}),
	].join("\n");
}

export function compileStageContracts<T extends XddStageSpec>(contracts: readonly T[]): readonly Readonly<T>[] {
	const violations: StageContractViolation[] = [];
	const stageOrder = new Map<XddStageName, number>();
	contracts.forEach((contract, index) => stageOrder.set(contract.name, index));

	for (const contract of contracts) {
		validateRequiredContractFields(contract, violations);
		validateGateHasPositiveDevelopment(contract, violations);
		validateRequiredOutputsCoveredByWriteScopes(contract, violations);
		validateAiGateArtifacts(contract, violations);
		validateRollback(contract, stageOrder, violations);
		validateSkippableWhen(contract, violations);
	}

	if (violations.length > 0) throw new StageContractError(violations);
	return Object.freeze(contracts.map((contract) => Object.freeze({ ...contract })));
}

/** A gate is only legal when the agent is told how to make its observations true first. */
function validateGateHasPositiveDevelopment(contract: XddStageSpec, violations: StageContractViolation[]): void {
	if (!Array.isArray(contract.desiredState) || contract.desiredState.length === 0 || contract.desiredState.some((item) => !item.trim())) {
		violations.push({
			stage: contract.name,
			field: "desiredState",
			message: "Gate 没有配对非空的正向开发目标",
			remediation: `在 ${contract.name}.desiredState 中先告诉 AI 要完成什么可观察结果，再运行 Gate。`,
		});
	}
}

function validateRequiredContractFields(contract: XddStageSpec, violations: StageContractViolation[]): void {
	for (const field of ["inputs", "outputs", "readScopes", "writeScopes", "gatePolicy", "hardGate", "rollbackPolicy"] as const) {
		if (contract[field] === undefined) {
			violations.push({
				stage: contract.name,
				field,
				message: `缺少 StageContract.${field} 声明`,
				remediation: `为 ${contract.name} 阶段显式声明 ${field}，不要依赖模型口头约定。`,
			});
		}
	}
}

function validateRequiredOutputsCoveredByWriteScopes(contract: XddStageSpec, violations: StageContractViolation[]): void {
	const writeScopes = contract.writeScopes ?? [];
	for (const output of contract.outputs ?? []) {
		if (!output.required) continue;
		if (!isCoveredByAnyScope(output.pattern, writeScopes)) {
			violations.push({
				stage: contract.name,
				field: "outputs",
				pattern: output.pattern,
				message: "必需输出没有被 writeScopes 覆盖",
				remediation: `把 ${output.pattern} 加入 ${contract.name}.writeScopes，或把输出改为非必需并说明 skip 条件。`,
			});
		}
	}
}

function validateAiGateArtifacts(contract: XddStageSpec, violations: StageContractViolation[]): void {
	const aiGate = contract.aiGate;
	if (!aiGate?.enabled) return;
	const outputPatterns = new Set((contract.outputs ?? []).map((output) => output.pattern));
	const contextPatterns = new Set(aiGate.contextPatterns);
	for (const pattern of aiGate.artifactPatterns) {
		if (!outputPatterns.has(pattern) && !contextPatterns.has(pattern)) {
			violations.push({
				stage: contract.name,
				field: "aiGate.artifactPatterns",
				pattern,
				message: "AI Gate artifact pattern 不来自 outputs，也不在 contextPatterns 中显式声明",
				remediation: "让 AI Gate 只审查阶段输出，或把额外上下文移入 aiGate.contextPatterns。",
			});
		}
	}
}

function validateRollback(
	contract: XddStageSpec,
	stageOrder: ReadonlyMap<XddStageName, number>,
	violations: StageContractViolation[],
): void {
	const policy = contract.rollbackPolicy;
	if (!policy || policy.target === "none") return;
	const from = stageOrder.get(contract.name);
	const target = stageOrder.get(policy.target);
	if (from === undefined || target === undefined || target >= from) {
		violations.push({
			stage: contract.name,
			field: "rollbackPolicy.target",
			pattern: policy.target,
			message: "rollback target 必须是当前阶段之前的阶段",
			remediation: "选择更早阶段作为 rollback target；verify 默认应回 execute。",
		});
	}
}

function validateSkippableWhen(contract: XddStageSpec, violations: StageContractViolation[]): void {
	const predicate = contract.skippableWhen;
	if (!predicate) return;
	if (!predicate.observable) {
		violations.push({
			stage: contract.name,
			field: "skippableWhen",
			message: "skippableWhen 必须是 Controller 可观察条件",
			remediation: "把 skip 条件改成可由文件/配置/runtime state 判断的条件。",
		});
	}
}

function isCoveredByAnyScope(pattern: string, scopes: readonly string[]): boolean {
	return scopes.some((scope) => scopeCoversPattern(scope, pattern));
}

export function scopeCoversPattern(scope: string, pattern: string): boolean {
	const normalizedScope = normalizeScope(scope);
	const normalizedPattern = normalizeScope(pattern);
	if (normalizedScope === "**" || normalizedScope === "**/*") return true;
	if (normalizedScope === normalizedPattern) return true;
	if (normalizedScope.endsWith("/**")) {
		const prefix = normalizedScope.slice(0, -3);
		return normalizedPattern === prefix || normalizedPattern.startsWith(`${prefix}/`);
	}
	if (!/[?*{}[\]]/.test(normalizedScope)) {
		return normalizedPattern === normalizedScope || normalizedPattern.startsWith(`${normalizedScope}/`);
	}
	return matchesGlob(normalizedScope, normalizedPattern);
}

function normalizeScope(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
}
