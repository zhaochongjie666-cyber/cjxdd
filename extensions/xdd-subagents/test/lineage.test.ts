import { describe, expect, it } from "vitest";
import { buildRunTree, renderRunTree } from "../lineage.ts";
import type { XddSubagentRunRecord } from "../runtime-store.ts";

function run(id: string, parentRunId?: string): XddSubagentRunRecord {
	return {
		id,
		parentRunId,
		mode: "single",
		status: "succeeded",
		agents: ["xdd-scout"],
		tasks: ["侦察"],
		cwd: "/tmp/project",
		createdAt: "2026-07-18T00:00:00.000Z",
		updatedAt: "2026-07-18T00:00:00.000Z",
		artifactDir: `/tmp/project/.xdd/subagents/artifacts/${id}`,
		transcriptPath: `/tmp/project/.xdd/subagents/artifacts/${id}/run.log`,
		results: [],
	};
}

describe("xdd subagent lineage", () => {
	it("builds and renders parent/child run trees", () => {
		const tree = buildRunTree([run("child", "root"), run("root")]);
		expect(tree).toHaveLength(1);
		expect(tree[0].children[0].id).toBe("child");
		const rendered = renderRunTree(tree);
		expect(rendered).toContain("- root single succeeded");
		expect(rendered).toContain("  - child single succeeded");
	});
});
