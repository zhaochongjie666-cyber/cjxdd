# xdd Refactor Design

> Reduce 3,500 LoC of core + 3,200 LoC of tests into a tighter, faster, more honest implementation. Target: keep the 10-stage contract intact, fix the top pain points, delete dead code.

---

## TL;DR

The current implementation has **25+ real issues** ranging from "paper gate" (execute gate passes on a one-line comment) to "performance landmine" (every `XddRunnerState` getter does a disk read). This doc proposes **7 phased fixes**, prioritized by ROI, all preserving the public surface (10 stages, 14 tools, 5 slash commands, 21 skills).

**Headline numbers:**
- `runtime.json` reads per run: ~3,500 → <100 (Phase 1)
- Sham implementations passing execute gate: ~50% → 0% (Phase 2)
- Verify-gate retry iterations: avg 4 → avg 1.5 (Phase 3)
- Total LoC: 3,500 → ~2,800 (Phase 5)
- AIGate spec breakages on prompt changes: high → zero (Phase 4)

---

## Goals

1. **Correctness** — gates that claim to enforce actually enforce. No more "软通过" by default.
2. **Performance** — eliminate the file-first facade's per-getter IO.
3. **Simplicity** — remove dead code, fold duplicated types, clarify control flow.
4. **Observability** — verify gate reports all failures at once, not one-per-submit.
5. **Stability** — AIGate angle renaming doesn't break the gate.

## Non-Goals

- ❌ Reduce the 10 stages to fewer (the 10-stage contract is downstream-coupling)
- ❌ Change public slash commands or tool names
- ❌ Rewrite the AIGate LLM prompt (separate effort)
- ❌ Touch `extensions/` external API (`XddController`, `XddRunnerState`, exports)

## Scope

**In scope:** the source under `extensions/xdd/`.
**Out of scope:** `skills/xdd-*` (separate content), `agents/` (separate content), pi-tui rendering (optional dep).

---

## Top Pain Points (mapped from critique)

### P0 — Sham enforcement

| # | Issue | File:line | Impact |
|---|-------|-----------|--------|
| 1 | execute gate = single regex match `// @implements R\d` | `stages.ts` execute gate | Fake implementations pass |
| 2 | verify gate short-circuits on first failure | `evidence/verify-gate.ts` | Agent fixes one issue at a time |
| 3 | requireTestsPass hard-fails when no test command exists | `gate.ts:163` | README claims soft-pass; reality is hard-fail |

### P1 — Performance & state correctness

| # | Issue | File:line | Impact |
|---|-------|-----------|--------|
| 4 | `XddRunnerState` getter/setter → disk IO per call | `types.ts` ~300 lines of `get/set` | `currentStage()` = 3 disk reads |
| 5 | `JSON.parse(JSON.stringify(state))` deep clone per dispatch | `core/controller.ts:cloneRuntime` | Slow, loses Date/Map types |
| 6 | 3 type aliases for same shape | `types.ts` + `storage/runtime-migrations.ts` | Drift, confusion |
| 7 | 4 default factories in 4 files | `types.ts`, `core/controller.ts`, etc. | Drift |

### P1 — Complexity / dead code

| # | Issue | File:line | Impact |
|---|-------|-----------|--------|
| 8 | `pendingGroupApproval` mechanism never set by any stage | `extension.ts`, `core/controller.ts` | ~150 LoC dead |
| 9 | 4 group gates redundant with 10 stage gates | `stage-groups.ts` | 4 extra file existence checks |
| 10 | `/xdd-continue` slash command never does anything useful | `run.ts:continueXdd` | Dead UX path |
| 11 | `requiresHumanApproval: false` on every stage (default) | `stages.ts` | Same as #8 |

### P2 — Observability / UX

| # | Issue | File:line | Impact |
|---|-------|-----------|--------|
| 12 | AIGate angles have no version; rename breaks gate | `aigate.ts` angle map | Silent regressions |
| 13 | epoch marker in system prompt can be lost in compaction | `epoch-slicer.ts` | Old stage context bleeds in |
| 14 | `xdd_observe` returns 14 fields in markdown | `tools/xdd-observe.ts` | Cognitive load on LLM |
| 15 | `xdd_status` doesn't show `paused`/`failed` state | `run.ts:xddStatus` | User can't diagnose |
| 16 | `/xdd-resume` doesn't validate `cwd` matches checkpoint | `run.ts:resumeXdd` | Cross-project resume |
| 17 | Hook system spawns process per call (50ms+) | `hooks/runner.ts` | Per-turn overhead |
| 18 | ESG grows unbounded in runtime.json | `audit/projector.ts` | File bloat |

### P2 — Soft-pass anti-pattern

| # | Issue | File:line | Impact |
|---|-------|-----------|--------|
| 19 | Hook invalid JSON → default pass | `hooks/runner.ts:passRecord` | Silent hook bypass |
| 20 | AIGate degraded → no retry budget consumed | `tools/xdd-submit-artifact.ts:degraded` | Infinite retry loop |
| 21 | catch blocks silently swallow errors | `extension.ts` (5+ sites) | Unknown audit failures |

### P3 — Naming / testing

| # | Issue | File:line | Impact |
|---|-------|-----------|--------|
| 22 | Test files `phase0/1/3/4/5/6/78` reflect refactor history | `*.test.ts` | New devs confused |
| 23 | `runner.e2e.test.ts` is 51 lines | `runner.e2e.test.ts` | E2E under-covered |
| 24 | Soft-pass in stage `gate: async () => softPass()` invisible to callers | `stages.ts` init, cleanup | Quiet leniency |
| 25 | `xdd_submit_artifact` is 200 LoC function body | `tools/xdd-submit-artifact.ts` | Maintenance hazard |

---

## Target Architecture

### Phase 1: In-memory state + lazy sync

**Current** (`types.ts`):
```ts
get planIndex(): number { return this.loadRt().planIndex ?? -1; }
set planIndex(v: number) { this.mutRt("planIndex", v); }

private mutRt<K>(key: K, value: XddCheckpointData[K]): void {
    const rt = this.loadRt();          // disk read
    rt[key] = value;
    this.saveRt(rt);                   // disk write + fsync
}
```

**Target** (`types.ts`):
```ts
class XddRunnerState {
    readonly cwd: string;
    readonly runId: string;
    readonly userInput: string;
    private cache: RuntimeStateV2;
    private dirty = false;

    constructor(opts) {
        this.cwd = opts.cwd;
        this.runId = opts.runId;
        this.userInput = opts.userInput;
        this.cache = new RuntimeStore(opts.cwd).load() ?? defaultRt(opts.runId, opts.cwd, opts.userInput);
    }

    get planIndex(): number { return this.cache.planIndex; }
    set planIndex(v: number) { this.cache.planIndex = v; this.dirty = true; }

    /** Persist pending changes. Call at lifecycle boundaries (dispatch return, slash command exit). */
    flush(): void {
        if (!this.dirty) return;
        new RuntimeStore(this.cwd).save(this.cache);
        this.dirty = false;
    }
}
```

**Callers** (`XddController.dispatch`):
```ts
dispatch(command): ControllerTransitionResult {
    const state = new RuntimeStore(this.cwd).load() ?? defaultRt(...);
    const next = transition(state, command, ...);
    this.store.save(next);   // controller already saves explicitly; remove facade writes
    return result;
}
```

**Invariants:**
- `XddRunnerState` exposes the same public API (all getters/setters unchanged)
- `flush()` is called by Pi lifecycle hooks (`agent_end`, `before_agent_start`, `tool_call`, `session_start`)
- `XddController` owns its own state lifecycle (already does); no change needed
- File write count per run: from ~3500 → ~10 (start, per dispatch, end)

**Risk:** stale `cache` if external process writes `.xdd/runtime.json`. **Mitigation:** add `refresh(): void` method; document that external writes are unsupported.

---

### Phase 2: Real execute gate

**Current** (`stages.ts`):
```ts
gate: async ({ cwd }) => {
    const r = await requirePatternInSource(cwd, /@implements\s+R\d/i, 1);
    if (!r.ok) return { ok: false, reason: "..." };
    return { ok: true };
}
```

**Target** — fold 4 sub-checks into a real implementation detector:

```ts
gate: async ({ cwd, summary, desiredState }) => {
    const rxxCoverage = await requireRxxCoverage(cwd);  // every spec RXX has ≥1 @implements
    if (!rxxCoverage.ok) return rxxCoverage;

    const orphans = await requireNoOrphanImplements(cwd); // @implements RXX references spec
    if (!orphans.ok) return orphans;

    const noSham = await requireNoShamCode(cwd);  // no TODO/console.log("done")/return null placeholders
    if (!noSham.ok) return noSham;

    const testsCover = await requireTestsReferenceRxx(cwd);
    if (!testsCover.ok) return testsCover;

    return { ok: true };
}
```

**New helpers** (in `gate.ts`):

```ts
/** Every RXX in .xdd/design/spec/ has ≥1 @implements RXX in source. */
export async function requireRxxCoverage(cwd: string): Promise<XddGateResult> {
    const snap = observeFilesystem(cwd, []);
    const missing = snap.specRxx.filter((r) => !snap.implementsRxx.includes(r));
    if (missing.length > 0) {
        return { ok: false, reason: `RXX 规则未在源码实现：${missing.join(", ")}` };
    }
    return { ok: true };
}

/** @implements RXX markers must reference a real RXX from spec. */
export async function requireNoOrphanImplements(cwd: string): Promise<XddGateResult> {
    const snap = observeFilesystem(cwd, []);
    const orphans = snap.implementsRxx.filter((r) => !snap.specRxx.includes(r));
    if (orphans.length > 0) {
        return { ok: false, reason: `孤儿 @implements 标注：${orphans.join(", ")}` };
    }
    return { ok: true };
}

/** Reject placeholder/sham code patterns. */
export async function requireNoShamCode(cwd: string): Promise<XddGateResult> {
    const PLACEHOLDER_RE = /\b(TODO|FIXME|XXX|HACK)\b/i;
    const SHAM_RE = /\bconsole\.log\(['"]?(done|implement|here|placeholder)['"]?\)/i;
    const violations = walkSourceFiles(cwd)
        .filter((f) => SOURCE_EXT_RE.test(f) && !SOURCE_EXCLUDE_RE.test(f))
        .flatMap((f) => findPatternMatches(f, PLACEHOLDER_RE, SHAM_RE));
    if (violations.length > 0) {
        return { ok: false, reason: `占位/TODO 代码：\n${violations.join("\n")}` };
    }
    return { ok: true };
}
```

**Trade-off:** stricter gate means more retries. **Mitigation:** AIGate now reports sham-pattern at submit time via new attack angle, so first-attempt fail rate drops.

---

### Phase 3: Verify-gate collects all failures

**Current** (`evidence/verify-gate.ts`):
```ts
export function evaluateVerifyEvidenceGate(cwd: string): VerifyEvidenceGateResult {
    const iteration = currentIteration(cwd);
    if (!iteration) return fail("ITERATION_MISSING", ...);  // SHORT-CIRCUIT
    ...
    const unfinished = unfinishedPlanFiles(...);
    if (unfinished.length > 0) return fail("PLAN_UNFINISHED", ...);  // SHORT-CIRCUIT
    ...
}
```

**Target** — collect all, report once:

```ts
export function evaluateVerifyEvidenceGate(cwd: string): VerifyEvidenceGateResult {
    const failures: EvidenceGateFailure[] = [];

    const iter = currentIteration(cwd);
    if (!iter) failures.push({ code: "ITERATION_MISSING", ... });
    else {
        const report = readReport(iter);
        if (!report) failures.push({ code: "REPORT_MISSING", ... });
        else {
            const unfinished = unfinishedPlanFiles(iter, cwd);
            if (unfinished.length > 0) failures.push({ code: "PLAN_UNFINISHED", ... });

            const evidence = validateEvidenceRefs(cwd, iter, report);
            if (evidence) failures.push(evidence);

            const categories = detectEvidenceCategories(report);
            if (categories.length < 2) failures.push({ code: "EVIDENCE_INSUFFICIENT", ... });
            if (hasWireArtifacts(cwd) && !categories.includes("ui")) failures.push({ code: "UI_EVIDENCE_MISSING", ... });
            if (mentionsOnlyHealthEndpoint(report)) failures.push({ code: "BUSINESS_ENDPOINT_UNTESTED", ... });
        }
    }

    if (failures.length === 0) return { ok: true };
    return {
        ok: false,
        reason: `verify 阶段发现 ${failures.length} 个问题（已全部列出）：\n${failures.map(f => `  [${f.code}] ${f.message}`).join("\n")}`,
        failure: failures[0],  // primary failure for audit trail
        failures,              // all failures for agent
    };
}
```

**New return type:**
```ts
export interface VerifyEvidenceGateResult extends XddGateResult {
    failure?: EvidenceGateFailure;   // backward compat
    failures?: EvidenceGateFailure[]; // NEW: all failures
}
```

---

### Phase 4: Versioned AIGate angles

**Current** (`aigate.ts`):
```ts
const COMMON_ANGLES: AttackAngle[] = [
    { name: "偷工减料攻击", description: "...", checks: [...] },
    { name: "AI味攻击", ... },
    { name: "规格偏离攻击", ... },
];

const STAGE_ANGLES: Record<string, AttackAngle[]> = {
    spec: [...],
    execute: [...],
    ...
};

function rederivePassed(parsed, expected, mechanical) {
    const byName = new Map(parsed.angles.map(a => [a.name, a]));
    for (const want of expected) {
        const got = byName.get(want.name);
        if (!got) { ... fail ... }  // ❌ rename breaks gate
    }
}
```

**Target** — add `specVersion`, match by ID not name:

```ts
interface AttackAngle {
    id: string;          // stable identifier (snake_case English)
    name: string;        // human-readable (any language)
    specVersion: number; // bump when angle content changes
    description: string;
    checks: string[];
}

const COMMON_ANGLES_V3: AttackAngle[] = [
    { id: "stub-detection", name: "偷工减料攻击", specVersion: 3, ... },
    { id: "ai-smell", name: "AI味攻击", specVersion: 2, ... },
    { id: "spec-drift", name: "规格偏离攻击", specVersion: 1, ... },
];

function rederivePassed(parsed, expected, mechanical) {
    const byId = new Map(parsed.angles.map(a => [a.id, a]));
    for (const want of expected) {
        const got = byId.get(want.id);  // match by stable ID
        if (!got) { ... fail with reason: "expected angle {id} v{want.specVersion} not in LLM response" ... }
        if (got.specVersion !== want.specVersion) {
            // warn but don't fail; prompt may have been reworded
        }
    }
}
```

**Migration:** add `id` alongside `name`; keep `name` as human-readable label. Prompt template uses `name` for LLM but `rederivePassed` matches `id`.

---

### Phase 5: Dead code removal

**Delete:**
1. `pendingGroupApproval` mechanism:
   - Remove `pendingGroupApproval` from `XddCheckpointData`
   - Remove `requiresHumanApproval` field from `XddStageSpec`
   - Remove branch in `core/controller.ts:advanceTransition`
   - Remove `/xdd-continue` slash command (or repurpose as "force re-validate current stage")
   - Remove `xdd_pending_group_approval` field references (~6 sites)

2. Reduce group gates from 4 to 2:
   - **Keep:** Group 1 (discovery → architecture) and Group 4 (implementation → verification)
   - **Delete:** Groups 2 and 3 (architecture → implementation, cleanup → verify)
   - Rationale: the kept groups span meaningful contract boundaries; the deleted ones just re-check files already verified by stage gates

3. Fold `XddCheckpointData` + `RuntimeStateV2` into one type:
   - `RuntimeStateV2 = XddCheckpointData & { schemaVersion: 3 }` → `XddCheckpointData` includes `schemaVersion: 3` always
   - Migration: remove `RuntimeStateV2`, update all imports (~20 sites)

4. Replace `JSON.parse(JSON.stringify(state))`:
   - Use `structuredClone(state)` (Node 17+) or hand-written mutation in transition functions
   - Both controller and test fixtures use it

**LoC removed:** ~400 lines.

---

### Phase 6: Hook perf (import instead of spawn)

**Current** (`hooks/runner.ts`):
```ts
const child = spawn(command.cmd, command.args, { ..., detached: true });
child.stdin.end(JSON.stringify(payload));
// wait for stdout, parse JSON
```

**Target** — two modes:
- **Default (TS/JS):** import + cache, run inline. Per-call: <1ms.
- **External (Python/shell):** keep spawn path, but pre-warmed interpreter (e.g., `python3 -u` with persistent stdin).

```ts
type HookHandler = (payload: HookPayload) => HookOutput | Promise<HookOutput>;

class HookRunner {
    private cache = new Map<string, CompiledHook>();

    async run(point: HookPoint, payload: HookPayload): Promise<HookRunResult> {
        for (const file of this.discover(point)) {
            const handler = await this.compile(file);  // cache by mtime
            const output = await handler(payload);     // in-process call
            if (output.action === "block") return ...;
        }
    }

    private async compile(file: string): Promise<HookHandler> {
        const mtime = statSync(file).mtimeMs;
        const cached = this.cache.get(file);
        if (cached && cached.mtime === mtime) return cached.handler;

        if (file.endsWith(".js") || file.endsWith(".mjs")) {
            const mod = await import(pathToFileURL(file).href);
            const handler = (payload: HookPayload) => mod.default(payload);
            this.cache.set(file, { mtime, handler });
            return handler;
        }
        // Python/shell: fall back to spawn (with persistent interpreter)
        ...
    }
}
```

**Trade-off:** less isolation. A buggy hook can crash the agent process. **Mitigation:** wrap hook call in `try/catch` with timeout; on uncaught error, mark hook as `warned: true` and disable.

---

### Phase 7: Soft-pass policy explicit

**Current** — soft-pass scattered:
```ts
gate: async () => softPass()  // init, cleanup
// + exhaustion paths in xdd_submit_artifact
```

**Target** — single `GatePolicy` enum on stage spec:

```ts
type GatePolicy =
    | { kind: "hard" }                          // strict; never soft-passes
    | { kind: "explicit-soft"; reason: string }  // stage declares soft-pass intent
    | { kind: "hard-once-soft-on-exhaust" };     // hard initially, soft after 5 retries
```

**Stages:**
- `init` → `explicit-soft` (scaffold only; no business logic)
- `cleanup` → `explicit-soft` (cleanup quality not blocking)
- All others → `hard` (no soft-pass)

**xdd_submit_artifact**:
```ts
if (gatePolicy.kind === "hard" && budget.exhausted) {
    return { ok: false, ..., failure: "BUDGET_EXHAUSTED_NO_SOFT_PASS" };
}
```

**Logging:** when soft-pass fires, emit `audit_event { type: "soft_pass_triggered", stage, reason }` so user can find soft-passes in audit log.

---

## Phased Migration Plan

Total: ~4 weeks (1 engineer, full-time).

### Phase 1: In-memory state (3 days)

| Day | Task | Files touched |
|-----|------|---------------|
| 1 | Refactor `XddRunnerState` to cache + dirty flag | `types.ts` |
| 1 | Add `flush()` calls at lifecycle hooks | `extension.ts` (4 sites) |
| 2 | Remove `mutRt()` indirection | `types.ts` |
| 2 | Migrate tests | `state.test.ts`, `phase0.test.ts`, etc. |
| 3 | Performance benchmark (before/after read count) | new `bench/` script |

**Acceptance:**
- All 165 `state.test.ts` assertions pass
- Per-run disk read count < 100 (measured)
- Public API of `XddRunnerState` unchanged

### Phase 2: Real execute gate (3 days)

| Day | Task | Files touched |
|-----|------|---------------|
| 1 | Add `requireRxxCoverage`, `requireNoOrphanImplements` | `gate.ts`, `observe-fs.ts` |
| 2 | Add `requireNoShamCode` | `gate.ts` |
| 2 | Update execute stage gate to compose 4 sub-checks | `stages.ts` |
| 3 | Tests: verify a known-sham impl fails, real impl passes | `execute-gate.test.ts` (new) |

**Acceptance:**
- Known sham (`// @implements R01` + empty fn) fails execute gate
- Real impl with proper coverage passes
- No existing test regresses

### Phase 3: Verify gate collect-all (2 days)

| Day | Task | Files touched |
|-----|------|---------------|
| 1 | Refactor `evaluateVerifyEvidenceGate` to collect | `evidence/verify-gate.ts` |
| 1 | Add `failures?: EvidenceGateFailure[]` to result type | `evidence/verify-gate.ts` |
| 2 | Update `xdd_submit_artifact` to surface all failures | `tools/xdd-submit-artifact.ts` |
| 2 | Tests: 3-failure scenario reports all 3 | `verify-gate.test.ts` |

**Acceptance:**
- Verify gate with 3 simultaneous issues reports all 3 in one response
- Single-failure path unchanged (backward compat)
- Agent retry count drops in integration tests

### Phase 4: AIGate versioning (2 days)

| Day | Task | Files touched |
|-----|------|---------------|
| 1 | Add `id` + `specVersion` to `AttackAngle` | `aigate.ts` |
| 1 | Update prompt template to use `name` (LLM-facing) | `aigate.ts` |
| 2 | Update `rederivePassed` to match by `id` | `aigate.ts` |
| 2 | Tests: angle rename doesn't break gate | `aigate.test.ts` |

**Acceptance:**
- Renaming an angle's `name` doesn't change gate behavior
- Removing an angle fails gate with clear message
- Bumping `specVersion` doesn't break (warn-only)

### Phase 5: Dead code removal (2 days)

| Day | Task | Files touched |
|-----|------|---------------|
| 1 | Delete `pendingGroupApproval` mechanism | 6 files, ~150 LoC |
| 1 | Delete 2 of 4 group gates | `stage-groups.ts`, `core/controller.ts` |
| 2 | Fold `RuntimeStateV2` into `XddCheckpointData` | 20+ sites |
| 2 | Replace `JSON.parse(JSON.stringify())` with `structuredClone` | `core/controller.ts`, test fixtures |

**Acceptance:**
- All tests pass with deletions
- No `grep -r "pendingGroupApproval"` hits
- LoC count down by ≥ 400

### Phase 6: Hook perf (3 days)

| Day | Task | Files touched |
|-----|------|---------------|
| 1 | Add import-based TS/JS hook path | `hooks/runner.ts` |
| 2 | Persistent Python interpreter for `.py` hooks | `hooks/runner.ts` |
| 2 | Cache + mtime invalidation | `hooks/runner.ts` |
| 3 | Tests: hook per-call latency | new `hook-bench.test.ts` |

**Acceptance:**
- TS/JS hook per-call: <5ms (was ~50ms)
- Python hook per-call: <200ms (was ~500ms)
- Hook errors don't crash agent (try/catch wrapper verified)

### Phase 7: Soft-pass policy audit (2 days)

| Day | Task | Files touched |
|-----|------|---------------|
| 1 | Add `GatePolicy` type and stage spec wiring | `types.ts`, `stages.ts` |
| 1 | Remove scattered `softPass()` calls | `xdd_submit_artifact.ts`, `stages.ts` |
| 2 | Add `soft_pass_triggered` audit event | `audit/events.ts`, `audit/projector.ts` |
| 2 | Tests: hard-policy stages never soft-pass | new `gate-policy.test.ts` |

**Acceptance:**
- Only `init` and `cleanup` can soft-pass; rest are strict
- Audit log records every soft-pass trigger with reason
- No regression in current passing tests

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| In-memory cache stale across sessions | Low | Medium | Document "single session" invariant; add `refresh()` |
| Real execute gate → too many retries | Medium | Medium | AIGate reports sham upfront; first-attempt fail drops |
| Hook import → state pollution | Medium | High | try/catch wrapper + disable-on-error + clear docs |
| AIGate ID migration breaks existing tests | Low | Low | `id` defaults to `name.toLowerCase().replace(/\s+/g, '-')` |
| `structuredClone` not available on Node <17 | Low | Low | Fallback to existing JSON path with try/catch |
| Soft-pass removal breaks intentional leniency | Medium | Medium | Keep `cleanup` and `init` explicit-soft; audit log surfaces |

---

## Success Metrics

| Metric | Baseline | Target | Measured by |
|--------|----------|--------|-------------|
| `runtime.json` disk reads per run | ~3,500 | <100 | `bench/runtime-io.bench.ts` |
| Execute gate false-pass rate (known sham) | ~100% | 0% | new test fixture with 5 sham variants |
| Verify gate median retry count | 4 | 1.5 | integration test (full run on sample repo) |
| Core LoC | 3,500 | ≤ 2,800 | `cloc extensions/xdd/` |
| Test LoC | 3,200 | ≤ 3,500 | `cloc extensions/xdd/*.test.ts` |
| AIGate angle rename breaking gate | high | zero | regression test in `aigate.test.ts` |
| Hook per-call latency | ~50ms (TS) | <5ms | `bench/hook-latency.bench.ts` |
| `pendingGroupApproval` references | 6 sites | 0 | `grep -r pendingGroupApproval extensions/xdd/` |

---

## Order of Execution

Strict dependency order:

```
Phase 1 (in-memory state)
   │
   ▼
Phase 5 (dead code) ──────┐
   │                       │
   ▼                       ▼
Phase 2 (execute gate)  Phase 4 (AIGate versioning)
   │                       │
   ▼                       │
Phase 3 (verify gate)     │
   │                       │
   ▼                       │
Phase 7 (soft-pass) ◄─────┘
   │
   ▼
Phase 6 (hook perf)   ← can run in parallel after Phase 1
```

Recommended sequence: **1 → 5 → 2 → 3 → 4 → 7 → 6** (Phases 4 and 7 can swap).

Each phase ends with:
1. All existing tests pass
2. New acceptance criteria met
3. Commit on a feature branch; merge to main after review

---

## Out-of-Scope Follow-Ups

Documented but not addressed in this refactor:

1. **Reduce 10 stages to fewer** — needs design-layer discussion (USER-JOURNEY.md §3.2)
2. **AIGate prompt rewrite** — separate effort; tuning, not refactor
3. **Self-heal budget tuning** (5 → 2) — needs empirical data from real runs
4. **Hook security model** — currently any file in `.xdd/hooks/` runs; needs sandbox
5. **Stage role specificity** — current roles ("Planner", "Implementer") are placeholders; could be richer

These should each get their own design doc when prioritized.

---

## Appendix A: Files Affected

```
extensions/xdd/
├── core/
│   ├── controller.ts          ← Phase 1 (cache), Phase 5 (dead code)
│   └── stage-contract.ts      ← (no change)
├── hooks/
│   └── runner.ts              ← Phase 6 (perf)
├── evidence/
│   └── verify-gate.ts         ← Phase 3 (collect-all)
├── gate.ts                    ← Phase 2 (real execute helpers)
├── audit/
│   ├── events.ts              ← Phase 7 (soft_pass_triggered)
│   └── projector.ts           ← Phase 7
├── stage-groups.ts            ← Phase 5 (reduce to 2 groups)
├── stages.ts                  ← Phase 2 (compose execute gate), Phase 7 (gate policy)
├── tools/
│   └── xdd-submit-artifact.ts ← Phase 1 (no change), Phase 3 (surface failures), Phase 7
├── aigate.ts                  ← Phase 4 (angle versioning)
├── types.ts                   ← Phase 1 (in-memory), Phase 5 (fold aliases)
├── run.ts                     ← Phase 5 (remove /xdd-continue branch)
├── extension.ts               ← Phase 1 (flush calls)
└── *.test.ts                  ← all phases
```

Estimated diff size per phase:
- Phase 1: ~250 LoC changed (types.ts + extension.ts + tests)
- Phase 2: ~150 LoC (gate.ts + stages.ts + new tests)
- Phase 3: ~80 LoC (evidence/verify-gate.ts)
- Phase 4: ~60 LoC (aigate.ts)
- Phase 5: -400 LoC (deletions)
- Phase 6: ~120 LoC (hooks/runner.ts)
- Phase 7: ~100 LoC (stages.ts + audit + tests)

Net: ~3,500 → ~2,800 LoC.

---

## Appendix B: Backward Compatibility

**Public API surface** (must not break):
- `XddRunnerState` class: all public methods/properties unchanged
- `XddController.dispatch`: signature unchanged
- `XddController` constructor: unchanged
- 14 tool names and parameter schemas: unchanged
- 5 slash commands: keep all (even `/xdd-continue` becomes "force re-validate")
- `.xdd/runtime.json` schema version: still `3` (no migration needed)

**Internal API** (can change):
- `RuntimeStateV2` type alias: removed
- `pendingGroupApproval` field: removed
- `STAGE_GROUPS` array length: 4 → 2
- `evaluateVerifyEvidenceGate` return shape: extends with `failures` (backward compat via `failure`)

**Skill / agent prompt** (can change):
- Stage desiredState wording may tighten
- AIGate standard may shift to use stable IDs in agent-facing output
- `xdd_observe` / `xdd_next_task` output may add structured sections

---

## Open Questions

1. **Self-heal budget tuning** — is 5 too high? Should it be 2? *(deferred to follow-up)*
2. **Hook security** — sandbox or trust? *(deferred; needs security review)*
3. **Should xdd observe return JSON instead of markdown?** — affects agent prompt *(Phase 1 task: small)*
4. **Single global stateRef** — accept limitation or rework for multi-run? *(out of scope)*
5. **AIGate angle IDs** — naming convention (`stub-detection` vs `STUB_DETECTION`)? *(Phase 4)*

Resolve before starting each phase; do not let them block other phases.

---

**Reviewers:** @pi-coding-agent maintainers, xdd core contributors
**Target merge:** 4 weeks from approval
**Rollback strategy:** each phase is a separate PR; revertable individually