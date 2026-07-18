import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type XddSubagent = {
	name: string;
	description: string;
	tools: string[];
	stageAffinity: string[];
	canEdit: boolean;
	prompt: string;
	path: string;
};

type Frontmatter = Record<string, string>;

const ROOT = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(ROOT, "agents");

function parseList(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseBoolean(value: string | undefined): boolean {
	return ["true", "yes", "1"].includes((value ?? "").trim().toLowerCase());
}

export function parseAgentMarkdown(markdown: string, filePath = "<memory>"): XddSubagent {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) throw new Error(`Agent file ${filePath} 缺少 YAML frontmatter`);
	const frontmatter: Frontmatter = {};
	for (const line of match[1].split(/\r?\n/)) {
		const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (parts) frontmatter[parts[1]] = parts[2].trim();
	}
	if (!frontmatter.name) throw new Error(`Agent file ${filePath} 缺少 name`);
	if (!frontmatter.description) throw new Error(`Agent ${frontmatter.name} 缺少 description`);
	return {
		name: frontmatter.name,
		description: frontmatter.description,
		tools: parseList(frontmatter.tools),
		stageAffinity: parseList(frontmatter.stageAffinity),
		canEdit: parseBoolean(frontmatter.canEdit),
		prompt: match[2].trim(),
		path: filePath,
	};
}

export function discoverXddSubagents(agentDir = AGENTS_DIR): XddSubagent[] {
	if (!existsSync(agentDir)) return [];
	return readdirSync(agentDir)
		.filter((file) => file.endsWith(".md"))
		.sort()
		.map((file) => {
			const filePath = join(agentDir, file);
			return parseAgentMarkdown(readFileSync(filePath, "utf8"), filePath);
		});
}

export function findXddSubagent(name: string, agents = discoverXddSubagents()): XddSubagent | undefined {
	const normalized = name.trim().toLowerCase();
	return agents.find((agent) => agent.name.toLowerCase() === normalized);
}

export function renderDelegationPrompt(agent: XddSubagent, task: string): string {
	const mode = agent.canEdit ? "可编辑：允许在明确任务范围内修改文件" : "只读：不得修改文件";
	return [`# Delegate to ${agent.name}`, "", agent.description, "", `工具边界：${agent.tools.join(", ") || "未声明"}`, `执行模式：${mode}`, "", "## Agent System Prompt", agent.prompt, "", "## Task", task.trim()].join("\n");
}
