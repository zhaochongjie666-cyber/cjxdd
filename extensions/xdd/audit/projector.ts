import type { RuntimeStateV2 } from "../storage/runtime-migrations.ts";
import type { XddEsgNodeType, XddStageName } from "../types.ts";
import type { XddAuditEvent } from "./events.ts";

export function projectAuditEvent(state: RuntimeStateV2, event: XddAuditEvent): RuntimeStateV2 {
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

export function appendEsg(state: RuntimeStateV2, type: XddEsgNodeType, stage: XddStageName, label: string, data?: unknown, parentId?: string): void {
	if (!state.esg) state.esg = [];
	const id = `esg-${state.esg.length + 1}`;
	state.esg.push({ id, type, stage, label, data, parentId, at: new Date().toISOString() });
}

function appendLedger(state: RuntimeStateV2, stage: XddStageName, stageIndex: number, passed: boolean, artifacts?: string[]): void {
	if (!state.ledger) state.ledger = [];
	const attempt = state.attempts?.[stage] ?? state.selfHealUsed?.[stage] ?? 0;
	state.ledger.push({ stage, stageIndex, attempt, status: passed ? "pass" : "fail", superseded: false, at: new Date().toISOString(), artifacts });
}

function normalizeStage(stage: XddStageName | "?"): XddStageName {
	return stage === "?" ? "init" : stage;
}


export interface XddAuditView {
	ledgerCount: number;
	esgCount: number;
	lastLedger?: string;
	lastFinding?: string;
	lastGate?: string;
}

export function buildAuditView(state: RuntimeStateV2): XddAuditView {
	const activeLedger = (state.ledger ?? []).filter((entry) => !entry.superseded);
	const lastLedgerEntry = activeLedger.at(-1);
	const findings = (state.esg ?? []).filter((node) => node.type === "finding");
	const lastFindingNode = findings.at(-1);
	const gateNode = [...(state.esg ?? [])].reverse().find((node) => node.label.startsWith("gate "));
	return {
		ledgerCount: activeLedger.length,
		esgCount: state.esg?.length ?? 0,
		lastLedger: lastLedgerEntry ? `${lastLedgerEntry.stage}:${lastLedgerEntry.status}:attempt${lastLedgerEntry.attempt}` : undefined,
		lastFinding: lastFindingNode ? `${lastFindingNode.label}${formatAuditDataMessage(lastFindingNode.data)}` : undefined,
		lastGate: gateNode ? `${gateNode.label}${formatAuditDataMessage(gateNode.data)}` : undefined,
	};
}

export function renderAuditView(view: XddAuditView): string {
	return [
		`Audit: ledger=${view.ledgerCount} active | esg=${view.esgCount}`,
		view.lastLedger ? `Audit last ledger: ${view.lastLedger}` : "",
		view.lastGate ? `Audit last gate: ${view.lastGate}` : "",
		view.lastFinding ? `Audit last finding: ${view.lastFinding}` : "",
	].filter(Boolean).join("\n");
}

function formatAuditDataMessage(data: unknown): string {
	if (!data || typeof data !== "object") return "";
	const maybe = data as { message?: unknown; reason?: unknown; code?: unknown };
	const parts = [maybe.code, maybe.message, maybe.reason]
		.filter((value) => typeof value === "string" && value.length > 0);
	return parts.length > 0 ? ` (${parts.join(": ")})` : "";
}
