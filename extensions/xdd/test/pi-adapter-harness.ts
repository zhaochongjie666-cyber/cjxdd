import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateXddExtension, deactivateXddExtension, xddInlineExtension } from "../extension.ts";
import { STAGES } from "../stages.ts";
import { XddRunnerState } from "../types.ts";

type Handler = (event?: any, ctx?: any) => any;

export interface FakeNotification {
	message: string;
	level?: string;
}

export class FakePiAdapterHarness {
	readonly cwd: string;
	readonly commands = new Map<string, any>();
	readonly tools: any[] = [];
	readonly handlers = new Map<string, Handler[]>();
	readonly sentMessages: Array<{ text: string; options?: any }> = [];
	readonly notifications: FakeNotification[] = [];
	readonly registeredRenderers: Array<{ type: string; renderer: unknown }> = [];
	state: XddRunnerState;
	idle = true;
	pendingMessages = false;
	aborted = false;
	contextUsage: { percent: number | null } | undefined;
	compactCalls: any[] = [];
	model: unknown = null;
	modelRegistry: unknown = null;

	constructor() {
		this.cwd = mkdtempSync(join(tmpdir(), "xdd-pi-adapter-"));
		this.state = new XddRunnerState({ runId: "harness", cwd: this.cwd, userInput: "test" });
		this.state.plan = STAGES.map((stage, originalIndex) => ({ stage, originalIndex }));
		this.state.startRun();
		activateXddExtension(this.state);
		xddInlineExtension.factory(this.pi as never);
	}

	private readonly pi = {
		registerCommand: (name: string, command: any) => {
			this.commands.set(name, command);
		},
		registerTool: (tool: any) => {
			this.tools.push(tool);
		},
		on: (eventName: string, handler: Handler) => {
			const handlers = this.handlers.get(eventName) ?? [];
			handlers.push(handler);
			this.handlers.set(eventName, handlers);
		},
		registerEntryRenderer: (type: string, renderer: unknown) => {
			this.registeredRenderers.push({ type, renderer });
		},
		sendUserMessage: async (text: string, options?: any) => {
			this.sentMessages.push({ text, options });
		},
	};

	readonly ctx = {
		cwd: this.cwd,
		ui: {
			notify: (message: string, level?: string) => {
				this.notifications.push({ message, level });
			},
		},
		waitForIdle: async () => undefined,
		isIdle: () => this.idle,
		abort: () => {
			this.aborted = true;
		},
		hasPendingMessages: () => this.pendingMessages,
		getContextUsage: () => this.contextUsage,
		compact: (options: any) => {
			this.compactCalls.push(options);
		},
		get signal() {
			return { aborted: false };
		},
		model: this.model,
		modelRegistry: this.modelRegistry,
	};

	async command(name: string, args = "") {
		const command = this.commands.get(name);
		if (!command) throw new Error(`command not registered: ${name}`);
		return await command.handler(args, this.ctx);
	}

	async emit(eventName: string, event: any = {}) {
		const results: any[] = [];
		for (const handler of this.handlers.get(eventName) ?? []) {
			results.push(await handler(event, this.ctx));
		}
		return results;
	}

	dispose() {
		deactivateXddExtension();
		rmSync(this.cwd, { recursive: true, force: true });
	}
}
