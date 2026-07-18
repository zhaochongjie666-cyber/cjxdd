export function recommendWatchdogModel(currentModel = ""): string {
	const normalized = currentModel.toLowerCase();
	if (normalized.includes("gpt") || normalized.includes("openai")) return "anthropic/claude-opus-4-8:high";
	if (normalized.includes("claude") || normalized.includes("opus") || normalized.includes("anthropic")) return "openai-codex/gpt-5.5:high";
	return "openai-codex/gpt-5.5:high";
}
