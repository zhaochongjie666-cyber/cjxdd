import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTraceCoverage, observeFilesystem } from "./observe-fs.ts";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "xdd-fs-"));
}

describe("observeFilesystem - empty / absent layout", () => {
	it("returns zeroed snapshot when nothing exists", () => {
		const dir = makeTmpDir();
		try {
			const snap = observeFilesystem(dir, ["docs/spec.md"]);
			expect(snap.checkpointExists).toBe(false);
			expect(snap.implementsCount).toBe(0);
			expect(snap.specRxx).toEqual([]);
			expect(snap.featureFiles).toBe(0);
			expect(snap.planTasks.total).toBe(0);
			expect(snap.deliverables).toHaveLength(1);
			expect(snap.deliverables[0].exists).toBe(false);
			expect(snap.deliverables[0].bytes).toBe(0);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("handles empty deliverablePaths (soft-pass stage)", () => {
		const dir = makeTmpDir();
		try {
			const snap = observeFilesystem(dir, []);
			expect(snap.deliverables).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});

describe("observeFilesystem - deliverables", () => {
	it("reports existing deliverable with byte size", () => {
		const dir = makeTmpDir();
		try {
			mkdirSync(join(dir, "docs"), { recursive: true });
			writeFileSync(join(dir, "docs", "spec.md"), "# spec\n".repeat(10));
			const snap = observeFilesystem(dir, ["docs/spec.md", "spec.md"]);
			const docsSpec = snap.deliverables.find((d) => d.path === "docs/spec.md");
			const rootSpec = snap.deliverables.find((d) => d.path === "spec.md");
			expect(docsSpec?.exists).toBe(true);
			expect(docsSpec?.bytes).toBeGreaterThan(0);
			expect(rootSpec?.exists).toBe(false);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("resolves glob deliverable patterns to first match", () => {
		const dir = makeTmpDir();
		try {
			mkdirSync(join(dir, ".xdd", "design", "spec", "B01"), { recursive: true });
			writeFileSync(join(dir, ".xdd", "design", "spec", "B01", "rules.md"), "# rules\n".repeat(5));
			const snap = observeFilesystem(dir, [".xdd/design/spec/**/rules.md"]);
			expect(snap.deliverables).toHaveLength(1);
			expect(snap.deliverables[0].exists).toBe(true);
			expect(snap.deliverables[0].bytes).toBeGreaterThan(0);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("reports glob deliverable as absent when no match", () => {
		const dir = makeTmpDir();
		try {
			const snap = observeFilesystem(dir, [".xdd/design/spec/**/rules.md"]);
			expect(snap.deliverables[0].exists).toBe(false);
			expect(snap.deliverables[0].bytes).toBe(0);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});

describe("observeFilesystem - checkpoint", () => {
	it("detects .xdd/checkpoint.json", () => {
		const dir = makeTmpDir();
		try {
			mkdirSync(join(dir, ".xdd"), { recursive: true });
			writeFileSync(join(dir, ".xdd", "checkpoint.json"), "{}");
			const snap = observeFilesystem(dir, []);
			expect(snap.checkpointExists).toBe(true);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});

describe("observeFilesystem - @implements markers", () => {
	it("counts @implements RXX across source files, skipping non-source and skip-dirs", () => {
		const dir = makeTmpDir();
		try {
			writeFileSync(join(dir, "app.py"), "# @implements R01\n# @implements R02\n");
			mkdirSync(join(dir, "sub"), { recursive: true });
			writeFileSync(join(dir, "sub", "svc.ts"), "// @implements B01-R03\n");
			// node_modules must be skipped even if it contains source files.
			mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
			writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "// @implements R99\n");
			// Non-source file is ignored.
			writeFileSync(join(dir, "README.md"), "@implements R07\n");
			const snap = observeFilesystem(dir, []);
			expect(snap.implementsCount).toBe(3);
			expect(snap.implementsRxx).toEqual(["B01-R03", "R01", "R02"]);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});

describe("observeFilesystem - .xdd spec", () => {
	it("collects RXX ids from rules.md and counts .feature files", () => {
		const dir = makeTmpDir();
		try {
			const specDir = join(dir, ".xdd", "design", "spec", "B01-auth");
			mkdirSync(specDir, { recursive: true });
			writeFileSync(
				join(specDir, "rules.md"),
				"# rules\n| R01 | login | ... |\n| R02 | lockout | ... |\n| B01-R03 | guard | ... |\n",
			);
			writeFileSync(join(specDir, "login.feature"), "Feature: login");
			writeFileSync(join(specDir, "lockout.feature"), "Feature: lockout");
			const snap = observeFilesystem(dir, []);
			expect(snap.specRxx).toEqual(["B01-R03", "R01", "R02"]);
			expect(snap.featureFiles).toBe(2);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});

describe("buildTraceCoverage", () => {
	it("finds unimplemented spec RXX and orphan code markers", () => {
		const dir = makeTmpDir();
		try {
			const specDir = join(dir, ".xdd", "design", "spec", "B01");
			mkdirSync(specDir, { recursive: true });
			writeFileSync(join(specDir, "rules.md"), "| R01 |\n| R02 |\n| R03 |\n");
			writeFileSync(join(specDir, "r01.feature"), "Feature");
			// R01 + R02 implemented; R04 is an orphan (no spec).
			writeFileSync(join(dir, "app.py"), "# @implements R01\n# @implements R02\n# @implements R04\n");
			const snap = observeFilesystem(dir, []);
			const cov = buildTraceCoverage(snap);
			expect(cov.specRxx).toEqual(["R01", "R02", "R03"]);
			expect(cov.implementedRxx).toEqual(["R01", "R02", "R04"]);
			expect(cov.unimplemented).toEqual(["R03"]);
			expect(cov.orphan).toEqual(["R04"]);
			expect(cov.featureFiles).toBe(1);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});

describe("observeFilesystem - .xdd plan tasks", () => {
	it("parses task checkboxes from xdd_run plan.md", () => {
		const dir = makeTmpDir();
		try {
			mkdirSync(join(dir, ".xdd", "runs", "xdd_run", "plan", "B01-auth"), { recursive: true });
			writeFileSync(
				join(dir, ".xdd", "runs", "xdd_run", "plan", "B01-auth", "plan.md"),
				[
					"- [ ] Task 1 pending",
					"- [~] Task 2 in progress",
					"- [x] Task 3 done",
					"- [!] Task 4 blocked",
					"- [x] Task 5 done",
					"regular text line",
				].join("\n"),
			);
			const snap = observeFilesystem(dir, []);
			expect(snap.planTasks.total).toBe(5);
			expect(snap.planTasks.pending).toBe(1);
			expect(snap.planTasks.inProgress).toBe(1);
			expect(snap.planTasks.done).toBe(2);
			expect(snap.planTasks.blocked).toBe(1);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("returns zero plan tasks when no .xdd/runs", () => {
		const dir = makeTmpDir();
		try {
			const snap = observeFilesystem(dir, []);
			expect(snap.planTasks.total).toBe(0);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});
