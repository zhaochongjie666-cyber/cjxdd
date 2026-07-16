import type { EntryRenderer } from "@earendil-works/pi-coding-agent";
import type { XddStageName } from "./types.ts";

export interface XddStageBoundaryData {
	runId: string;
	stage: XddStageName;
	index: number;
	total: number;
	attempt: number;
}

export interface XddReflectStartData {
	runId: string;
	failedStage: XddStageName;
	attempt: number;
}

export interface XddReflectEndData {
	runId: string;
	failedStage: XddStageName;
	layer: string;
	reason: string;
	rolled: string;
}

export interface XddRollbackData {
	runId: string;
	from: XddStageName;
	to: XddStageName;
	reason: string;
}

interface TextLikeComponent {
	text: string;
	x: number;
	y: number;
	render?: () => string;
}

function line(text: string): TextLikeComponent {
	// Keep this renderer dependency-free so xdd can be imported in test and
	// startup environments where the optional pi-tui package is unavailable.
	// pi TUI renderers only need a component-like value; newer hosts may render
	// the object directly, and older hosts skip renderer registration entirely.
	return { text, x: 0, y: 0, render: () => text };
}

export const renderStageBoundary: EntryRenderer<XddStageBoundaryData> = (entry, _options, _theme) => {
	const d = entry.data;
	if (!d) return undefined;
	return line(`─── xdd: ${d.stage} (${d.index + 1}/${d.total}) attempt #${d.attempt} ───`) as never;
};

export const renderReflectStart: EntryRenderer<XddReflectStartData> = (entry, _options, _theme) => {
	const d = entry.data;
	if (!d) return undefined;
	return line(`─── 反思：${d.failedStage} 阶段未通过（attempt #${d.attempt}）───`) as never;
};

export const renderReflectEnd: EntryRenderer<XddReflectEndData> = (entry, _options, _theme) => {
	const d = entry.data;
	if (!d) return undefined;
	return line(`─── 诊断：${d.layer}${d.reason ? ` — ${d.reason}` : ""} ───`) as never;
};

export const renderRollback: EntryRenderer<XddRollbackData> = (entry, _options, _theme) => {
	const d = entry.data;
	if (!d) return undefined;
	return line(`─── 回退：${d.from} → ${d.to}${d.reason ? `（${d.reason}）` : ""} ───`) as never;
};
