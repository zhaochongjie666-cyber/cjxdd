export interface BashPolicyInput {
	command?: string;
	timeout?: number;
	description?: string;
}

export interface BashPolicyViolation {
	reason: string;
	command: string;
}

const FORBIDDEN_BASH: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /\bfind\s+\/\s*(?!-)/, reason: "find / 会扫描整个文件系统" },
	{ pattern: /\bfind\s+\/\s*-/, reason: "find /<args> 会扫描整个文件系统" },
	{ pattern: /\brm\s+(-[a-zA-Z]*\s+)*\/\s*(?:-|$|\.)/, reason: "rm -rf / 会删除整个系统" },
	{ pattern: /\bdd\s+if=\/dev\/(zero|urandom)\s+of=\/dev\//, reason: "dd 到设备会清空磁盘" },
	{ pattern: /\bmkfs(\.\w+)?\s+\/dev\//, reason: "mkfs 会格式化磁盘" },
	{ pattern: />\s*\/(?!tmp\/)[^\s]+/, reason: "禁止通过 shell 重定向写 cwd 外绝对路径" },
];

export function applyBashPolicy(input: BashPolicyInput): BashPolicyViolation | null {
	if (input.timeout === undefined || input.timeout <= 0) input.timeout = 300;
	const command = String(input.command ?? "");
	for (const forbidden of FORBIDDEN_BASH) {
		if (forbidden.pattern.test(command)) return { reason: forbidden.reason, command };
	}
	return null;
}
