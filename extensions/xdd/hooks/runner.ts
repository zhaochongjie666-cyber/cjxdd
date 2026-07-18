import { spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { HOOK_EXTENSIONS, type HookOutput, type HookPayload, type HookPoint, type HookRunResult, type HookExecutionRecord } from "./protocol.ts";

export interface HookRunnerOptions {
	timeoutMs?: number;
	maxStdoutBytes?: number;
	maxStderrBytes?: number;
	signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT = 64 * 1024;
const MAX_CONTINUE_PROMPT = 4 * 1024;

export class HookRunner {
	readonly cwd: string;
	readonly hooksRoot: string;
	readonly timeoutMs: number;
	readonly maxStdoutBytes: number;
	readonly maxStderrBytes: number;
	readonly signal?: AbortSignal;

	constructor(cwd: string, options: HookRunnerOptions = {}) {
		this.cwd = cwd;
		this.hooksRoot = join(cwd, ".xdd", "hooks");
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_OUTPUT;
		this.maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_OUTPUT;
		this.signal = options.signal;
	}

	async run(point: HookPoint, payload: HookPayload): Promise<HookRunResult> {
		const files = discoverHookFiles(this.hooksRoot, point);
		const records: HookExecutionRecord[] = [];
		const warnings: string[] = [];
		const prompts: string[] = [];
		for (const file of files) {
			const record = await runHookFile(file, payload, {
				cwd: this.cwd,
				timeoutMs: this.timeoutMs,
				maxStdoutBytes: this.maxStdoutBytes,
				maxStderrBytes: this.maxStderrBytes,
				signal: this.signal,
			});
			records.push(record);
			if (record.warning) warnings.push(record.warning);
			if (record.output.action === "block") {
				return { action: "block", reason: record.output.reason ?? `hook blocked: ${file}`, records, warnings };
			}
			if (record.output.action === "continue" && record.output.prompt) prompts.push(record.output.prompt);
		}
		const prompt = prompts.join("\n\n").slice(0, MAX_CONTINUE_PROMPT);
		return prompt ? { action: "continue", prompt, records, warnings } : { action: "pass", records, warnings };
	}
}

export function discoverHookFiles(hooksRoot: string, point: HookPoint): string[] {
	const dir = join(hooksRoot, point);
	if (!existsSync(dir)) return [];
	if (isSymlink(hooksRoot) || isSymlink(dir)) return [];
	const hooksRootReal = safeRealpath(hooksRoot);
	const dirReal = safeRealpath(dir);
	if (!hooksRootReal || !dirReal || !isWithinDirectory(hooksRootReal, dirReal)) return [];
	return readdirSync(dirReal, { withFileTypes: true })
		.filter((entry) => entry.isFile() && HOOK_EXTENSIONS.has(extname(entry.name)))
		.map((entry) => join(dirReal, entry.name))
		.filter((file) => {
			const real = safeRealpath(file);
			if (!real || !isWithinDirectory(hooksRootReal, real)) return false;
			try { return lstatSync(real).isFile(); } catch { return false; }
		})
		.sort((a, b) => a.localeCompare(b));
}

function safeRealpath(path: string): string | null {
	try { return realpathSync(path); } catch { return null; }
}

function isSymlink(path: string): boolean {
	try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

function isWithinDirectory(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`/`) && !rel.startsWith(`\\`));
}

interface RunFileOptions {
	cwd: string;
	timeoutMs: number;
	maxStdoutBytes: number;
	maxStderrBytes: number;
	signal?: AbortSignal;
}

async function runHookFile(file: string, payload: HookPayload, options: RunFileOptions): Promise<HookExecutionRecord> {
	const command = commandForHook(file);
	if (!command) {
		return passRecord(file, `unsupported hook extension: ${extname(file)}`);
	}
	return await new Promise<HookExecutionRecord>((resolve) => {
		let stdout = "";
		let stderr = "";
		let done = false;
		let timedOut = false;
		const child = spawn(command.cmd, command.args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"], detached: true });
		const finish = (record: HookExecutionRecord) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", abortHandler);
			resolve(record);
		};
		const killGroup = () => {
			try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch {}
			setTimeout(() => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {} }, 250).unref?.();
		};
		const timer = setTimeout(() => {
			timedOut = true;
			killGroup();
			finish(passRecord(file, `hook timed out after ${options.timeoutMs}ms`, stderr, true));
		}, options.timeoutMs);
		const abortHandler = () => {
			killGroup();
			finish(passRecord(file, "hook aborted", stderr));
		};
		options.signal?.addEventListener("abort", abortHandler, { once: true });
		child.stdout.on("data", (chunk: Buffer) => { stdout = appendLimited(stdout, chunk, options.maxStdoutBytes); });
		child.stderr.on("data", (chunk: Buffer) => { stderr = appendLimited(stderr, chunk, options.maxStderrBytes); });
		child.on("error", (error) => finish(passRecord(file, `hook start failed: ${error.message}`, stderr)));
		child.on("close", () => {
			if (timedOut) return;
			finish(parseHookOutput(file, stdout, stderr));
		});
		child.stdin.end(JSON.stringify(payload));
	});
}

function commandForHook(file: string): { cmd: string; args: string[] } | null {
	const ext = extname(file);
	if (ext === ".py") return { cmd: "python3", args: [file] };
	if (ext === ".ts") return { cmd: process.execPath, args: ["--experimental-strip-types", file] };
	if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return { cmd: process.execPath, args: [file] };
	return null;
}

function parseHookOutput(file: string, stdout: string, stderr: string): HookExecutionRecord {
	const trimmed = stdout.trim();
	if (!trimmed) return { file, output: { action: "pass" }, stderr };
	try {
		const parsed = JSON.parse(trimmed) as Partial<HookOutput>;
		if (parsed.action === "block" || parsed.action === "continue" || parsed.action === "pass") {
			return { file, output: { action: parsed.action, reason: parsed.reason, prompt: parsed.prompt }, stderr };
		}
		return passRecord(file, "hook output action unknown; default pass", stderr);
	} catch (error) {
		return passRecord(file, `hook output invalid JSON; default pass: ${error instanceof Error ? error.message : String(error)}`, stderr);
	}
}

function passRecord(file: string, warning: string, stderr = "", timedOut = false): HookExecutionRecord {
	return { file, output: { action: "pass" }, stderr, warning, timedOut };
}

function appendLimited(current: string, chunk: Buffer, maxBytes: number): string {
	const next = current + chunk.toString("utf8");
	return Buffer.byteLength(next) <= maxBytes ? next : next.slice(0, maxBytes);
}
