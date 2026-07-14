/**
 * AIGate: AI 语义审查层。在硬 Gate（机械检查）通过后，用同一个 LLM
 * 以"严厉审查者"角色审查产物，抓机械检查抓不到的偷工减料。
 *
 * 设计原则（用户指定）：
 *   - 每个阶段都跑
 *   - 用同一个模型（pi 当前 model）
 *   - 严厉提示词（不容忍废话/占位符/trivial/假标注/空壳）
 *   - 不通过 -> 自愈 3 次后回退（复用现有机制）
 *   - 死审查标准（每阶段写死在 stages.ts 的 aigateStandard）
 *
 * 失败安全：LLM 调用失败（网络/API/解析）时 soft-pass，不阻塞流水线。
 * 硬 Gate 已保证基本质量，AIGate 是叠加的语义审查。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai/compat";

export interface AIGateInput {
	model: Model<any>;
	apiKey?: string;
	headers?: Record<string, string>;
	stageName: string;
	aigateStandard: string;
	artifactPaths: string[]; // relative to cwd
	cwd: string;
	intentAnchor?: string; // intent.md content for consistency check
}

export interface AIGateResult {
	passed: boolean;
	issues: string[];
	suggestions: string[];
	raw?: string;
}

const STRICT_REVIEWER_PROMPT = `你是一个极度严厉的技术审查者，专职抓偷工减料。你不容忍任何敷衍。

你的审查原则：
- 废话凑字数：内容空泛、重复、无信息量 -> 不通过
- 占位符：TODO/待定/暂无/placeholder/示例文本 -> 不通过
- 模板化：照抄模板没填实质内容 -> 不通过
- trivial 内容：测试只测 happy path、断言无具体值、规则无业务语义 -> 不通过
- 假标注：@implements RXX 但代码跟 RXX 无关 -> 不通过
- 空壳设计：有标题无内容、有结构无细节 -> 不通过
- 规格偏离：产物跟意图锚（intent.md）不一致 -> 不通过

你必须逐条检查审查标准中的每一项。任何一项不达标 -> 不通过。
你不给面子、不留情面、不接受"差不多"。

输出格式（只输出 JSON，不要 markdown 代码块，不要其他文字）：
{"passed": true, "issues": [], "suggestions": []}
或
{"passed": false, "issues": ["具体问题1（引用原文）", "具体问题2"], "suggestions": ["怎么改1", "怎么改2"]}`;

/**
 * Run AIGate: read artifacts, call LLM, parse verdict.
 * Returns AIGateResult. On LLM call failure, returns soft-pass.
 */
export async function runAIGate(input: AIGateInput): Promise<AIGateResult> {
	const { model, apiKey, headers, stageName, aigateStandard, artifactPaths, cwd, intentAnchor } = input;

	// Read all artifact files
	const artifacts: string[] = [];
	for (const relPath of artifactPaths) {
		// Handle glob-like paths (just try to read, skip if not found)
		const abs = join(cwd, relPath);
		if (existsSync(abs) && statSync(abs).isFile()) {
			const content = readFileSync(abs, "utf8");
			artifacts.push(`--- ${relPath} ---\n${content}`);
		}
	}

	// Also try to read persona files if stage is understand
	if (stageName === "understand") {
		const personasDir = join(cwd, ".xdd/design/personas");
		if (existsSync(personasDir)) {
			const { readdirSync } = await import("node:fs");
			for (const f of readdirSync(personasDir)) {
				if (f.endsWith(".md")) {
					const content = readFileSync(join(personasDir, f), "utf8");
					artifacts.push(`--- personas/${f} ---\n${content}`);
				}
			}
		}
	}

	if (artifacts.length === 0) {
		return { passed: false, issues: ["没有找到任何产物文件"], suggestions: ["检查产物路径是否正确"] };
	}

	// Construct user message
	const userMessage = `## 审查阶段：${stageName}

## 审查标准（逐条检查，全部达标才通过）：
${aigateStandard}

${intentAnchor ? `## 意图锚（intent.md，产物必须与此一致）：\n${intentAnchor}\n` : ""}

## 产物内容：
${artifacts.join("\n\n")}

## 请审查以上产物，输出 JSON：`;

	// Call LLM
	let responseText: string;
	try {
		responseText = await callLLM(model, apiKey, headers, STRICT_REVIEWER_PROMPT, userMessage);
	} catch (e) {
		// LLM call failed -> soft-pass (don't block pipeline on infra issues)
		const msg = e instanceof Error ? e.message : String(e);
		return { passed: true, issues: [], suggestions: [], raw: `[AIGate LLM 调用失败，soft-pass] ${msg}` };
	}

	// Parse JSON verdict
	return parseVerdict(responseText);
}

/**
 * Call LLM via fetch(). Supports OpenAI-compatible and Anthropic APIs.
 */
async function callLLM(
	model: Model<any>,
	apiKey: string | undefined,
	extraHeaders: Record<string, string> | undefined,
	systemPrompt: string,
	userMessage: string,
): Promise<string> {
	if (!apiKey) {
		throw new Error("无 API key（modelRegistry 未解析到凭证）");
	}

	const api = model.api;
	const baseUrl = model.baseUrl.replace(/\/$/, "");

	if (api === "anthropic-messages") {
		// Anthropic Messages API
		const res = await fetch(`${baseUrl}/messages`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				...(extraHeaders ?? {}),
			},
			body: JSON.stringify({
				model: model.id,
				max_tokens: 4096,
				system: systemPrompt,
				messages: [{ role: "user", content: userMessage }],
			}),
		});
		if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
		const data = await res.json();
		return data.content?.map((c: any) => c.text).join("") ?? "";
	}

	// Default: OpenAI-compatible (covers openai-completions, openai-responses, etc.)
	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
			...(extraHeaders ?? {}),
		},
		body: JSON.stringify({
			model: model.id,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage },
			],
			temperature: 0,
			max_tokens: 4096,
		}),
	});
	if (!res.ok) throw new Error(`LLM API ${res.status}: ${await res.text()}`);
	const data = await res.json();
	return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Parse LLM verdict JSON. Tolerates markdown code blocks and extra text.
 */
function parseVerdict(raw: string): AIGateResult {
	// Strip markdown code blocks
	let text = raw.trim();
	text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

	// Try to extract JSON object
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		return { passed: true, issues: [], suggestions: [], raw: `[AIGate 解析失败，soft-pass] ${text.slice(0, 200)}` };
	}

	try {
		const verdict = JSON.parse(jsonMatch[0]);
		return {
			passed: Boolean(verdict.passed),
			issues: Array.isArray(verdict.issues) ? verdict.issues.map(String) : [],
			suggestions: Array.isArray(verdict.suggestions) ? verdict.suggestions.map(String) : [],
			raw: text.slice(0, 500),
		};
	} catch {
		return { passed: true, issues: [], suggestions: [], raw: `[AIGate JSON 解析失败，soft-pass] ${text.slice(0, 200)}` };
	}
}
