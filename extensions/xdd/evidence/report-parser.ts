export function stripFencedCode(markdown: string): string {
	return markdown.replace(/```[\s\S]*?```/g, "");
}

export function hasUnfinishedPlanCheckbox(markdown: string): boolean {
	return stripFencedCode(markdown)
		.split(/\r?\n/)
		.some((line) => /^\s*-\s*\[\s\]\s+/.test(line));
}

export function extractEvidenceReferences(markdown: string): string[] {
	const refs = new Set<string>();
	const withoutCode = stripFencedCode(markdown);
	const re = /(?:^|[\s([`'"])(\.xdd\/runs\/iter-[^\s)'"`]+\/evidence\/[^\s)'"`]+)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(withoutCode))) {
		refs.add(match[1].replace(/[.,;:]+$/, ""));
	}
	return [...refs];
}

export type EvidenceCategory = "runtime" | "http" | "ui" | "db" | "auth" | "boundary" | "chaos" | "stub";

const CATEGORY_PATTERNS: Record<EvidenceCategory, RegExp> = {
	runtime: /\b(npm|pnpm|yarn|go test|cargo test|pytest|vitest|build|exit code|退出码|测试命令)\b/i,
	http: /\b(curl|HTTP\/?\d?|status\s*[:=]?\s*[245]\d\d|GET\s+\/|POST\s+\/)\b/i,
	ui: /\b(screenshot|截图|DOM|HTML|accessibility|可访问性|playwright)\b/i,
	db: /\b(database|数据库|SQL|query|insert|select|持久化|重启后)\b/i,
	auth: /\b(401|403|auth|token|session|角色|权限)\b/i,
	boundary: /\b(boundary|边界|空值|超限|重复|并发|非法输入)\b/i,
	chaos: /\b(chaos|kill|network|故障|恢复|依赖暂停)\b/i,
	stub: /\b(stub|mock|存根|扫描)\b/i,
};

export function detectEvidenceCategories(markdown: string): EvidenceCategory[] {
	const content = stripFencedCode(markdown);
	return (Object.keys(CATEGORY_PATTERNS) as EvidenceCategory[]).filter((category) => CATEGORY_PATTERNS[category].test(content));
}
