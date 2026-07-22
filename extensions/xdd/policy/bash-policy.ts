export interface BashPolicyInput {
	command?: string;
	timeout?: number;
	description?: string;
}

export interface BashPolicyViolation {
	reason: string;
	command: string;
}

interface BashStageLike {
	name: string;
	writeScopes?: readonly string[];
}

const FORBIDDEN_BASH: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /\bfind\s+\/\s*(?!-)/, reason: "find / 会扫描整个文件系统" },
	{ pattern: /\bfind\s+\/\s*-/, reason: "find /<args> 会扫描整个文件系统" },
	{ pattern: /\brm\s+(-[a-zA-Z]*\s+)*\/(?:\s*(?:-|$|\.)|[*?])/, reason: "rm -rf / 会删除整个系统" },
	{ pattern: /\bdd\s+if=\/dev\/(zero|urandom)\s+of=\/dev\//, reason: "dd 到设备会清空磁盘" },
	{ pattern: /\bmkfs(\.\w+)?\s+\/dev\//, reason: "mkfs 会格式化磁盘" },
	{ pattern: /(?:^|[\s'"/])\.env(?:\.(?!(?:example|sample|template)(?:[\s'";|&]|$))[^\s'";|&]*)?(?=[\s'";|&]|$)/i, reason: "禁止通过 shell 访问敏感环境文件" },
	{ pattern: /(?:^|[\s'"/])(?:credentials|secrets)(?:\.json)?(?=[\s'";|&]|$)/i, reason: "禁止通过 shell 访问凭据或密钥文件" },
	{ pattern: /\.(?:pem|key|p12|pfx)(?=[\s'";|&]|$)/i, reason: "禁止通过 shell 访问私钥文件" },
];

export function applyBashPolicy(input: BashPolicyInput): BashPolicyViolation | null {
	if (input.timeout === undefined || input.timeout <= 0) input.timeout = 300;
	const command = String(input.command ?? "");
	for (const forbidden of FORBIDDEN_BASH) {
		if (forbidden.pattern.test(command)) return { reason: forbidden.reason, command };
	}
	return null;
}

/**
 * Shell syntax cannot be parsed safely enough to infer every file it may
 * modify.  For scoped stages, reject explicit shell-write primitives instead
 * of letting bash bypass the write/edit path policy. Commands such as `npm
 * test` remain available; stages that genuinely own the whole workspace
 * (execute/cleanup) retain their existing behaviour through writeScopes=**.
 */
export function applyStageBashPolicy(stage: BashStageLike, input: BashPolicyInput): BashPolicyViolation | null {
	const generic = applyBashPolicy(input);
	if (generic) return generic;
	if (stage.writeScopes?.includes("**")) return null;
	const command = String(input.command ?? "");
	for (const forbidden of SCOPED_STAGE_BASH_WRITES) {
		if (forbidden.pattern.test(command)) {
			return {
				reason: `${stage.name} 阶段禁止通过 bash ${forbidden.reason}；请使用受 writeScopes 校验的 write/edit 工具`,
				command,
			};
		}
	}
	return null;
}

const SCOPED_STAGE_BASH_WRITES: Array<{ pattern: RegExp; reason: string }> = [
	// Do not treat fd redirects (2>&1) as file writes. Any other redirect is
	// rejected conservatively: a shell command is too ambiguous to prove that
	// its destination is inside the stage's declared write scopes.
	{ pattern: /(?:^|[^&])(?:>>?|<>)\s*(?!&\d)(?:[^\s;|&]+)/, reason: "重定向写入文件" },
	{ pattern: /\btee\b/, reason: "使用 tee 写入文件" },
	{ pattern: /\b(?:touch|mkdir|cp|mv|rm|install)\b/, reason: "执行文件变更命令" },
	{ pattern: /\b(?:sed|perl|python(?:3)?|ruby|node|deno|sh|bash|zsh|fish)\b[^\n]*(?:\s-i\b|\s-[ce]\b)/, reason: "使用解释器原地或脚本写入" },
];
