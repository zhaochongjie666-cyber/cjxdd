import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOOK_POINTS } from "./protocol.ts";

export function scaffoldHooks(cwd: string): { created: string[]; skipped: string[] } {
	const root = join(cwd, ".xdd", "hooks");
	const created: string[] = [];
	const skipped: string[] = [];
	const dirs = [root, ...HOOK_POINTS.map((point) => join(root, point)), join(root, "examples")];
	for (const dir of dirs) {
		if (existsSync(dir)) skipped.push(relativeHookPath(cwd, dir));
		else {
			mkdirSync(dir, { recursive: true });
			created.push(relativeHookPath(cwd, dir));
		}
	}
	const readme = join(root, "README.md");
	if (existsSync(readme)) skipped.push(relativeHookPath(cwd, readme));
	else {
		writeFileSync(readme, hookReadme(), "utf8");
		created.push(relativeHookPath(cwd, readme));
	}
	const example = join(root, "examples", "continue-example.js");
	if (existsSync(example)) skipped.push(relativeHookPath(cwd, example));
	else {
		writeFileSync(example, `// Copy into ../turn_start/ to inject a prompt.\nprocess.stdin.resume();\nprocess.stdin.on('end', () => {\n  console.log(JSON.stringify({ action: 'continue', prompt: 'Project hook reminder.' }));\n});\n`, "utf8");
		created.push(relativeHookPath(cwd, example));
	}
	return { created, skipped };
}

function relativeHookPath(cwd: string, path: string): string {
	return path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
}

function hookReadme(): string {
	return `# xdd hooks\n\nHook scripts live under one of: turn_start, before_tools, tool_use_done, turn_end.\n\nSupported extensions: .js, .mjs, .cjs, .ts, .py. Scripts receive JSON on stdin and should print JSON on stdout:\n\n\`\`\`json\n{ "action": "pass" }\n{ "action": "block", "reason": "explain why" }\n{ "action": "continue", "prompt": "extra prompt for the next step" }\n\`\`\`\n\nInvalid or empty output defaults to pass and is recorded as a warning. Each hook times out after 10 seconds.\n`;
}
