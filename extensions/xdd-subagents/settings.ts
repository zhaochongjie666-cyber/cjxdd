import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type XddSubagentsSettings = {
	defaultModel?: string;
	defaultProvider?: string;
	agentOverrides?: Record<string, { model?: string; provider?: string; disabled?: boolean; thinking?: string; fallbackModels?: string[]; modelScope?: string }>;
	thinking?: string;
	fallbackModels?: string[];
	modelScope?: string;
	watchdog?: { enabled?: boolean; model?: string; maxDiffBytes?: number };
	autoDrain?: { enabled?: boolean; notify?: boolean };
};

function readJson(filePath: string): unknown {
	if (!existsSync(filePath)) return undefined;
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return undefined;
	}
}

function extractSubagentsSettings(value: unknown): XddSubagentsSettings {
	const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
	const raw = root.xddSubagents ?? root.subagents ?? {};
	if (!raw || typeof raw !== "object") return {};
	const settings = raw as Record<string, unknown>;
	return {
		defaultModel: typeof settings.defaultModel === "string" ? settings.defaultModel : undefined,
		defaultProvider: typeof settings.defaultProvider === "string" ? settings.defaultProvider : undefined,
		thinking: typeof settings.thinking === "string" ? settings.thinking : undefined,
		fallbackModels: Array.isArray(settings.fallbackModels) ? settings.fallbackModels.filter((entry): entry is string => typeof entry === "string") : undefined,
		modelScope: typeof settings.modelScope === "string" ? settings.modelScope : undefined,
		agentOverrides: settings.agentOverrides && typeof settings.agentOverrides === "object" ? settings.agentOverrides as XddSubagentsSettings["agentOverrides"] : undefined,
		watchdog: settings.watchdog && typeof settings.watchdog === "object" ? settings.watchdog as XddSubagentsSettings["watchdog"] : undefined,
		autoDrain: settings.autoDrain && typeof settings.autoDrain === "object" ? settings.autoDrain as XddSubagentsSettings["autoDrain"] : undefined,
	};
}

export function loadXddSubagentsSettings(cwd: string): XddSubagentsSettings {
	const user = extractSubagentsSettings(readJson(join(homedir(), ".pi", "agent", "settings.json")));
	const project = extractSubagentsSettings(readJson(join(cwd, ".pi", "settings.json")));
	return {
		defaultModel: project.defaultModel ?? user.defaultModel,
		defaultProvider: project.defaultProvider ?? user.defaultProvider,
		thinking: project.thinking ?? user.thinking,
		fallbackModels: project.fallbackModels ?? user.fallbackModels,
		modelScope: project.modelScope ?? user.modelScope,
		agentOverrides: { ...(user.agentOverrides ?? {}), ...(project.agentOverrides ?? {}) },
		watchdog: { ...(user.watchdog ?? {}), ...(project.watchdog ?? {}) },
		autoDrain: { ...(user.autoDrain ?? {}), ...(project.autoDrain ?? {}) },
	};
}

export type ResolvedPiInvocation = { model?: string; provider?: string; thinking?: string; fallbackModels?: string[]; modelScope?: string };

export function resolveTaskModel(cwd: string, agent: string, explicitModel?: string): string | undefined {
	return resolvePiInvocation(cwd, agent, { model: explicitModel }).model;
}

export function resolvePiInvocation(cwd: string, agent: string, explicit: ResolvedPiInvocation = {}): ResolvedPiInvocation {
	const settings = loadXddSubagentsSettings(cwd);
	const override = settings.agentOverrides?.[agent];
	if (override?.disabled) throw new Error(`xdd subagent ${agent} 已被 settings 禁用`);
	return {
		model: explicit.model?.trim() || override?.model || settings.defaultModel,
		provider: explicit.provider?.trim() || override?.provider || settings.defaultProvider,
		thinking: explicit.thinking?.trim() || override?.thinking || settings.thinking,
		fallbackModels: explicit.fallbackModels?.length ? explicit.fallbackModels : override?.fallbackModels ?? settings.fallbackModels,
		modelScope: explicit.modelScope?.trim() || override?.modelScope || settings.modelScope,
	};
}
