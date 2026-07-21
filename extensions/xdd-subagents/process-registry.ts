/**
 * Child processes owned by this extension instance.
 *
 * PIDs persisted in a project-local runtime file are untrusted: a repository
 * can edit that file and point it at an unrelated host process.  Destructive
 * process operations must therefore use this in-memory ownership registry.
 */
const ownedChildren = new Map<string, Set<number>>();

export function registerOwnedChild(runId: string, pid: number | undefined): void {
	if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return;
	const pids = ownedChildren.get(runId) ?? new Set<number>();
	pids.add(pid);
	ownedChildren.set(runId, pids);
}

export function unregisterOwnedChild(runId: string, pid: number | undefined): void {
	if (!pid) return;
	const pids = ownedChildren.get(runId);
	if (!pids) return;
	pids.delete(pid);
	if (pids.size === 0) ownedChildren.delete(runId);
}

export function ownedChildPids(runId: string): number[] {
	return [...(ownedChildren.get(runId) ?? [])];
}
