import type { RuntimeStateV2 } from "../storage/runtime-migrations.ts";
import type { NfEsgNodeType, NfStageName } from "../types.ts";
import type { NfAuditEvent } from "./events.ts";

export const MAX_RUNTIME_ESG_NODES = 500;

export function projectAuditEvent(state: RuntimeStateV2, event: NfAuditEvent): RuntimeStateV2 {
	const next = state;
	switch (event.type) {
		case "command_accepted":
			appendEsg(next, "checkpoint", normalizeStage(event.stage), `command accepted: ${event.command}`);
			break;
		case "command_rejected":
			appendEsg(next, "finding", normalizeStage(event.stage), `command rejected: ${event.command}`, { code: event.code, message: event.message });
			break;
		case "effect_success":
			appendEsg(next, "evidence", normalizeStage(event.stage), `effect success: ${event.effect}`, event.detail ? { detail: event.detail } : undefined);
			break;
		case "effect_fail":
			appendEsg(next, "finding", normalizeStage(event.stage), `effect failed: ${event.effect}`, { message: event.message });
			break;
		case "gate_result":
			appendLedger(next, event.stage, event.stageIndex, event.passed, event.artifacts);
			appendEsg(next, event.passed ? "evidence" : "finding", event.stage, `gate ${event.passed ? "pass" : "fail"}: ${event.stage}`, { reason: event.reason, artifacts: event.artifacts });
			break;
		case "hook_result":
			appendEsg(next, event.action === "block" ? "finding" : "evidence", normalizeStage(event.stage), `hook ${event.hook}: ${event.action}`, { warnings: event.warnings, data: event.data });
			break;
		case "provider_error":
			appendEsg(next, "finding", normalizeStage(event.stage), "provider error", { message: event.message });
			break;
		case "task_result":
			appendEsg(next, "task", event.stage, `next task: ${event.action}（diff met=${event.met} unmet=${event.unmet}）`, { action: event.action, met: event.met, unmet: event.unmet });
			break;
		case "esg_record":
			appendEsg(next, event.nodeType, event.stage, event.label, event.data, event.parentId);
			break;
	}
	return next;
}

export function appendEsg(state: RuntimeStateV2, type: NfEsgNodeType, stage: NfStageName, label: string, data?: unknown, parentId?: string): void {
	if (!state.esg) state.esg = [];
	const id = nextEsgId(state.esg);
	state.esg.push({ id, type, stage, label, data, parentId, at: new Date().toISOString() });
	compactRuntimeEsg(state);
}

export function compactRuntimeEsg(state: Pick<RuntimeStateV2, "esg">): void {
	if (state.esg && state.esg.length > MAX_RUNTIME_ESG_NODES) {
		state.esg.splice(0, state.esg.length - MAX_RUNTIME_ESG_NODES);
	}
}

function nextEsgId(nodes: readonly { id: string }[]): string {
	const largest = nodes.reduce((max, node) => {
		const match = /^esg-(\d+)$/.exec(node.id);
		return match ? Math.max(max, Number(match[1])) : max;
	}, 0);
	return `esg-${largest + 1}`;
}

function appendLedger(state: RuntimeStateV2, stage: NfStageName, stageIndex: number, passed: boolean, artifacts?: string[]): void {
	if (!state.ledger) state.ledger = [];
	const attempt = state.attempts?.[stage] ?? state.selfHealUsed?.[stage] ?? 0;
	state.ledger.push({ stage, stageIndex, attempt, status: passed ? "pass" : "fail", superseded: false, at: new Date().toISOString(), artifacts });
}

function normalizeStage(stage: NfStageName | "?"): NfStageName {
	return stage === "?" ? "understand" : stage;
}
