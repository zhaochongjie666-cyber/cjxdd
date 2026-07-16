import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, sep } from "node:path";

export interface VerifySnapshot {
	createdAt: string;
	files: Record<string, string>;
}

export interface VerifySnapshotDiff {
	changed: string[];
	added: string[];
	deleted: string[];
}

const SNAPSHOT_PATH = ".xdd/verify-snapshot.json";
const SOURCE_PREFIXES = ["src", "lib", "test", "tests", "bin", "cmd", "internal", "pkg", "source", "app", "server", "client"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".cs", ".php", ".rb", ".swift", ".c", ".cc", ".cpp", ".h", ".hpp"]);

export function ensureVerifySnapshot(cwd: string): VerifySnapshot {
	const existing = readVerifySnapshot(cwd);
	if (existing) return existing;
	const snapshot = takeVerifySnapshot(cwd);
	writeVerifySnapshot(cwd, snapshot);
	return snapshot;
}

export function takeVerifySnapshot(cwd: string): VerifySnapshot {
	const files: Record<string, string> = {};
	for (const file of walk(cwd)) {
		const rel = relative(cwd, file).split(sep).join("/");
		if (!isTrackedVerifyContractPath(rel)) continue;
		files[rel] = hashFile(file);
	}
	return { createdAt: new Date().toISOString(), files };
}

export function diffVerifySnapshot(cwd: string): VerifySnapshotDiff {
	const before = readVerifySnapshot(cwd) ?? takeVerifySnapshot(cwd);
	const after = takeVerifySnapshot(cwd);
	const changed: string[] = [];
	const added: string[] = [];
	const deleted: string[] = [];
	for (const [file, hash] of Object.entries(after.files)) {
		if (!(file in before.files)) added.push(file);
		else if (before.files[file] !== hash) changed.push(file);
	}
	for (const file of Object.keys(before.files)) {
		if (!(file in after.files)) deleted.push(file);
	}
	return { changed: changed.sort(), added: added.sort(), deleted: deleted.sort() };
}

export function clearVerifySnapshot(cwd: string): void {
	rmSync(join(cwd, SNAPSHOT_PATH), { force: true });
}

export function formatVerifySnapshotDiff(diff: VerifySnapshotDiff): string {
	const files = [...diff.changed.map((f) => `changed:${f}`), ...diff.added.map((f) => `added:${f}`), ...diff.deleted.map((f) => `deleted:${f}`)];
	return files.join(", ");
}

function readVerifySnapshot(cwd: string): VerifySnapshot | null {
	const path = join(cwd, SNAPSHOT_PATH);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as VerifySnapshot;
	} catch {
		return null;
	}
}

function writeVerifySnapshot(cwd: string, snapshot: VerifySnapshot): void {
	const path = join(cwd, SNAPSHOT_PATH);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(snapshot, null, 2));
}

function* walk(root: string): Generator<string> {
	if (!existsSync(root)) return;
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if ([".git", "node_modules"].includes(entry.name)) continue;
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === ".xdd") {
				yield* walk(join(path, "design"));
				continue;
			}
			yield* walk(path);
		} else if (entry.isFile()) {
			yield path;
		}
	}
}

function isTrackedVerifyContractPath(rel: string): boolean {
	if (rel.startsWith(".xdd/design/")) return true;
	const first = rel.split("/")[0] ?? "";
	if (!SOURCE_PREFIXES.includes(first)) return false;
	const dot = rel.lastIndexOf(".");
	return dot >= 0 && SOURCE_EXTENSIONS.has(rel.slice(dot));
}

function hashFile(path: string): string {
	const stat = statSync(path);
	const hash = createHash("sha1");
	hash.update(readFileSync(path));
	return `${stat.size}:${hash.digest("hex")}`;
}
