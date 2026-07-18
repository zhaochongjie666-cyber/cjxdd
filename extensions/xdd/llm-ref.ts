/**
 * Shared LLM reference for AIGate. Set by extension.ts before_agent_start,
 * read by xdd_submit_artifact. Separate module to avoid circular dependency
 * (extension.ts -> tools -> submit-artifact -> extension.ts).
 */
let modelRef: any = null;
let modelRegistryRef: any = null;

export function setLLMRef(model: any, registry: any): void {
	modelRef = model;
	modelRegistryRef = registry;
}

export async function getAIGateLLM(): Promise<{ model: any; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> } | null> {
	if (!modelRef || !modelRegistryRef) return null;
	try {
		const auth = await modelRegistryRef.getApiKeyAndHeaders(modelRef);
		if (!auth.ok) return null;
		return { model: modelRef, apiKey: auth.apiKey, headers: auth.headers, env: auth.env };
	} catch {
		return null;
	}
}
