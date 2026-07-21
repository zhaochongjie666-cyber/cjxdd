import { pathToFileURL } from "node:url";

const [mode, modulePath, nonce] = process.argv.slice(2);

function reply(value) {
	process.stdout.write(`\n${nonce}${JSON.stringify(value)}\n`);
}

try {
	const imported = await import(`${pathToFileURL(modulePath).href}?isolated=${Date.now()}`);
	const tool = imported.default;
	if (mode === "inspect") {
		reply({ ok: true, value: {
			name: tool?.name,
			label: tool?.label,
			description: tool?.description,
			parameters: tool?.parameters,
			promptSnippet: tool?.promptSnippet,
			promptGuidelines: tool?.promptGuidelines,
			hasExecute: typeof tool?.execute === "function",
		} });
	} else if (mode === "execute") {
		let input = "";
		for await (const chunk of process.stdin) input += chunk;
		const request = JSON.parse(input || "{}");
		const value = await tool.execute(request.params, { cwd: request.cwd });
		reply({ ok: true, value });
	} else {
		throw new Error(`unknown isolated runner mode: ${mode}`);
	}
} catch (error) {
	reply({ ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
}
