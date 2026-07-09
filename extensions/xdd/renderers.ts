import { type Component, Text } from "@earendil-works/pi-tui";
import type { EntryRenderer } from "../core/extensions/types.ts";
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

function line(text: string): Component {
	return new Text(text, 0, 0);
}

export const renderStageBoundary: EntryRenderer<XddStageBoundaryData> = (entry, _options, _theme) => {
	const d = entry.data;
	if (!d) return undefined;
	return line(`─── xdd: ${d.stage} (${d.index + 1}/${d.total}) attempt #${d.attempt} ───`);
};

export const renderReflectStart: EntryRenderer<XddReflectStartData> = (entry, _options, _theme) => {
	const d = entry.data;
	if (!d) return undefined;
	return line(`─── 反思：${d.failedStage} 阶段未通过（attempt #${d.attempt}）───`);
};

export const renderReflectEnd: EntryRenderer<XddReflectEndData> = (entry, _options, _theme) => {
	const d = entry.data;
	if (!d) return undefined;
	return line(`─── 诊断：${d.layer}${d.reason ? ` — ${d.reason}` : ""} ───`);
};

export const renderRollback: EntryRenderer<XddRollbackData> = (entry, _options, _theme) => {
	const d = entry.data;
	if (!d) return undefined;
	return line(`─── 回退：${d.from} → ${d.to}${d.reason ? `（${d.reason}）` : ""} ───`);
};
