import { XddSubagentRunStore, type XddSubagentRunRecord } from "./runtime-store.ts";

export type RunTreeNode = XddSubagentRunRecord & { children: RunTreeNode[] };

export function buildRunTree(runs: XddSubagentRunRecord[]): RunTreeNode[] {
	const nodes = new Map<string, RunTreeNode>();
	for (const run of runs) nodes.set(run.id, { ...run, children: [] });
	const roots: RunTreeNode[] = [];
	for (const node of nodes.values()) {
		const parent = node.parentRunId ? nodes.get(node.parentRunId) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	return roots;
}

export function loadRunTree(cwd: string): RunTreeNode[] {
	return buildRunTree(new XddSubagentRunStore(cwd).load().runs);
}

export function renderRunTree(nodes: RunTreeNode[], depth = 0): string {
	const lines: string[] = [];
	for (const node of nodes) {
		lines.push(`${"  ".repeat(depth)}- ${node.id} ${node.mode} ${node.status} [${node.agents.join(",")}]`);
		const childText = renderRunTree(node.children, depth + 1);
		if (childText) lines.push(childText);
	}
	return lines.join("\n");
}
