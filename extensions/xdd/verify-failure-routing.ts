import type { EvidenceGateFailure } from "./evidence/verify-gate.ts";
import type { XddStageName } from "./types.ts";

export interface VerifyFailureRoute {
	target: XddStageName;
	reason: string;
	ownerScopes: string[];
	closureCriteria: string[];
	invalidate: Array<"verify-evidence" | "review" | "release-decision">;
}

/**
 * Deterministically route a failed verify verdict to the earliest owning stage.
 * Evidence failures take precedence over prose because they are observable; the
 * report/gate text is then used to distinguish a design contract gap from an
 * implementation defect when evidence cannot name the owning layer.
 */
export function routeVerifyFailure(input: {
	summary: string;
	gateReason?: string;
	failure?: EvidenceGateFailure;
}): VerifyFailureRoute {
	const evidence = input.failure;
	const detail = [evidence ? `${evidence.code}: ${evidence.message}` : "", input.gateReason ?? "", input.summary]
		.filter(Boolean)
		.join("\n");
	const files = evidence?.files ?? [];
	const codeTarget = targetFromCode(evidence?.code);
	const designTarget = codeTarget ?? targetFromDesignFiles(files) ?? targetFromText(detail);

	if (designTarget) {
		return route(designTarget, `${detail || "verify verdict failed"}\n路由: ${designTarget}（结构化 failure code/负责范围）。`, evidence);
	}
	if (evidence) {
		return route("execute", `${detail}\n路由: execute（可观测验证/实现缺陷）。`, evidence);
	}
	if (/\b(test|tests?|harness|endpoint|api|code|bug|implementation|实现|测试|端点|接口|编译|构建)\b/i.test(detail)) {
		return route("execute", `${detail}\n路由: execute（实现缺陷）。`, evidence);
	}
	// Failing closed to execute is safe: it never skips verification and avoids
	// asking the model to choose a rollback target without evidence.
	return route("execute", `${detail || "verify verdict failed; no diagnosable evidence"}\n路由: execute（无法定位时的安全默认）。`, evidence);
}

function targetFromCode(code?: string): XddStageName | undefined {
	if (code === "PLAN_UNFINISHED" || code === "FEATURE_SCENARIO_GAP") return "plan";
	if (code === "TRACE_GAP" || code === "VERIFY_COMMAND_FAILED" || code === "BLIND_JOURNEY_FAILED") return "execute";
	return undefined;
}

function route(target: XddStageName, reason: string, failure?: EvidenceGateFailure): VerifyFailureRoute {
	const ownerScopes = target === "execute" ? ["src/**", "lib/**", "app/**", "test/**", "tests/**"]
		: target === "plan" ? [".xdd/runs/xdd_run/plan/**", ".xdd/runs/xdd_run/plan.md", ".xdd/runs/xdd_run/qa-plan*"]
		: [`.xdd/design/${target}/**`];
	return { target, reason, ownerScopes, closureCriteria: [failure?.remediation ?? `修复 ${target} 负责范围`, `${failure?.code ?? "原 verify failure"} 的机械检查转绿`], invalidate: ["verify-evidence", "review", "release-decision"] };
}

function targetFromDesignFiles(files: readonly string[]): XddStageName | undefined {
	const joined = files.join("\n");
	if (/\.xdd\/design\/architecture\/.*\/resilience|resilience\/|failure-modes/i.test(joined)) return "resilience";
	if (/\.xdd\/design\/architecture\//i.test(joined)) return "architecture";
	if (/\.xdd\/design\/(spec|intent|design)\//i.test(joined)) return "spec";
	return undefined;
}

function targetFromText(text: string): XddStageName | undefined {
	if (/\b(resilience|retry|timeout|idempoten|circuit.breaker|failure.mode)\b/i.test(text) || /韧性|重试|超时|降级|故障模式/.test(text)) return "resilience";
	if (/\b(architecture|architectural|component.boundary|data.model|dependency)\b/i.test(text) || /架构|组件边界|数据模型|依赖/.test(text)) return "architecture";
	if (/\b(spec.gap|rule.gap|acceptance.criteria|business.rule|contract.gap)\b/i.test(text) || /规则缺口|需求缺口|验收标准|规格缺口/.test(text)) return "spec";
	return undefined;
}
