import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("./isolated-runner.mjs", import.meta.url));
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1_000_000;

export interface IsolatedRequest {
	mode: "inspect" | "execute";
	modulePath: string;
	params?: unknown;
	cwd?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export async function runIsolated(request: IsolatedRequest): Promise<unknown> {
	const nonce = `__XDD_TOOL_RESULT_${randomBytes(16).toString("hex")}__`;
	const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["--max-old-space-size=128", RUNNER, request.mode, request.modulePath, nonce], {
			cwd: request.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, NODE_OPTIONS: "" },
		});
		let stdout = "", stderr = "", settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (error?: Error, value?: unknown) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			request.signal?.removeEventListener("abort", abort);
			if (!child.killed) child.kill("SIGKILL");
			error ? reject(error) : resolve(value);
		};
		const append = (current: string, chunk: Buffer) => {
			const next = current + chunk.toString("utf8");
			if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) finish(new Error(`动态工具输出超过 ${MAX_OUTPUT_BYTES} 字节，已终止隔离进程`));
			return next;
		};
		child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
		child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
		child.stdin.on("error", (error) => { if (!settled) finish(error); });
		child.on("error", (error) => finish(error));
		child.on("exit", (code, signal) => {
			if (settled) return;
			const marker = stdout.lastIndexOf(nonce);
			if (marker < 0) return finish(new Error(`动态工具隔离进程异常退出（code=${code}, signal=${signal}）：${stderr.slice(-2000)}`));
			try {
				const response = JSON.parse(stdout.slice(marker + nonce.length).trim());
				if (!response.ok) finish(new Error(`动态工具执行失败：${response.error}`));
				else finish(undefined, response.value);
			} catch (error) { finish(new Error(`无法解析动态工具隔离结果：${error instanceof Error ? error.message : String(error)}`)); }
		});
		const abort = () => finish(new Error("动态工具执行已取消"));
		timer = setTimeout(() => finish(new Error(`动态工具超过 ${timeoutMs}ms，已终止隔离进程`)), timeoutMs);
		if (request.signal?.aborted) abort();
		else request.signal?.addEventListener("abort", abort, { once: true });
		if (!settled) {
			if (request.mode === "execute") child.stdin.end(JSON.stringify({ params: request.params, cwd: request.cwd }));
			else child.stdin.end();
		}
	});
}
