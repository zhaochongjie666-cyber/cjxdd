# AGENTS.md — cjpi

> Conversational style: Chinese is fine for prose; tech names stay English. No emojis in commits, docs, comments, or code. Answer questions first, then edit. Say outright when you agree/disagree with feedback before describing what you changed.

## What this repo is — read first

This is the xdd **framework** repo at `/home/zhaocj/ws/cjpi`. A separate sibling `/home/zhaocj/ws/cjxdd` (referenced by `regression/run-nightly.sh` cron path) holds the original "source of truth" version — their layouts differ; keep them in sync manually if you touch both.

`pi/` lives here as a nested git working tree (its own `.git/` at `pi/.git`, on branch `main`) — **not** wired via `.gitmodules` yet. It's the upstream pi-mono source. Its own `pi/AGENTS.md` governs work inside `pi/`. Do not run pi's `npm run check` / `./test.sh` from this root — `cd pi` first.

When you edit framework code (anything NOT under `pi/`), this file applies. When you touch anything under `pi/`, defer to `pi/AGENTS.md` and use `pi/` as cwd.

## Repo map (only the load-bearing parts)

| Path | Owned by | When to edit |
|------|----------|--------------|
| `agents/` | xdd | New/modify agent (`xdd-walker`, `xdd-orchestrator`, `phase-*`) |
| `skills/` | xdd | New/modify one of the 17 xdd skills |
| `extensions/xdd/` | xdd → pi | xdd's inline-extension implementation for pi-coding-agent (the rest of `extensions/` mirrors `pi/packages/coding-agent/examples/extensions/`) |
| `workflow/` | xdd | Python CLI runner (`run_workflow.py`, `gate.py`, `claude_runner.py`, `nodes.py`, `iter_utils.py`, `models.py`, `CLAUDE.md`, `.xdd/`, `web/` server + tests) |
| `regression/` | xdd | Nightly cron harness — `run-nightly.sh`, `lib/m2cc-env.sh`, `prompts/{trial-e2e,fix-verify}.md` (in sibling `/home/zhaocj/ws/cjxdd`) |
| `pi/` | upstream pi-mono (nested git) | NEVER as part of xdd work — PR upstream |
| `core.md` | xdd philosophy | **DO NOT EDIT** (locked by `workflow/CLAUDE.md` rule 1) |
| `install.sh` | xdd | Install flow that symlinks `agents/` + `skills/` into a harness dir |
| `archive/` | historical | Read-only prior layouts (2026-06 snapshots). Don't modify |

## Commands unique to this repo

```bash
# xdd framework smoke (deterministic, no LLM, ~seconds)
bash skills/smoke-xdd-design-anchor.sh

# Stub / fake-impl guard — run before any framework commit
bash skills/xdd-execute/scripts/no-stub-check.sh [path...]

# Nightly regression: 3 fresh empty-tree trials + auto fix-verify (~40 min/trial)
# NOTE: regression/ dir lives in sibling repo /home/zhaocj/ws/cjxdd, not here
bash regression/run-nightly.sh
TRIALS=1 bash regression/run-nightly.sh          # debug
TRIAL_TMO=600 TRIALS=1 bash regression/run-nightly.sh   # shorter cap

# Workflow CLI (Python entry from cjpi root)
python -m workflow.run_workflow --help
#   -t, --task_dir    项目目录(需含 prd.md)
#   -m, --model       模型(默认 YACC,可选 OPENAI/ANTHROPIC等)
#   -b, --bizline     业务线 slug(默认 B01)
#   -f, --force       忽略已有产物全重跑
# Max iter loop: MAX_ITER=5 (workflow/run_workflow.py:26)

# First-time install of agents/skills into a harness dir
./install.sh                                     # auto-detects ~/.config/opencode / ~/.pi / ~/.claude
TARGET_DIR=~/.config/opencode ./install.sh       # explicit
```

Inside `pi/` (submodule) use pi's own commands — `npm run check`, `./test.sh`, `./pi-test.sh`. Don't apply them at this root.

## Hard "don't"s (from `workflow/CLAUDE.md` global rules)

These are **non-negotiable**, enforced at commit time by `no-stub-check.sh`:

- **No mocks, no InMemoryRepository, no mock DB, no hardcoded `current_user`/`user_id`.**
- **No escape-hatch try/catch that swallows errors** or returns silent defaults. Let failures surface.
- **No "implement later" stubs** in shipped code — `pass` / `TODO` / `NotImplementedError` / `raise NotImplemented` / `return None` placeholders are all forbidden in code paths.
- **Don't bypass pre-commit** (`--no-verify`, editing hooks to skip).
- **Don't `git reset --hard` / `git checkout .` / `git clean -fd` / `git stash` / `git add -A`** — multiple agents/sessions edit this checkout concurrently.

## XDD vocabulary (use these exact terms)

When describing changes, name the anchor layer being touched:

- 设计层 (design layer): `xdd-brainstorm` → `xdd-spec` (RXX 规则) → `xdd-architecture` → `xdd-wire` → `xdd-resilience`
- 桥接: `xdd-plan` (each task explicitly cites RXX)
- 代码层 (code layer): `xdd-execute` (writes `@implements RXX` comments), `xdd-verify`
- 业务线: `BXX` (e.g. `B01-auth`, `B02-order`); one BXX per business line, RXXs inside are `B01-R01`, `B01-R02`…
- Workspace: `.xdd/` (in products) holds the anchor layers; here `workflow/.xdd/` is a sample instance

Full glossary + flow: `workflow/.xdd/WORKFLOW.md`. Read it before adding/changing agents, skills, or sub-agent behaviour.

## Self-tests when changing framework code

Run in this order; stop on first failure:

1. `bash skills/smoke-xdd-design-anchor.sh` — fast, deterministic (always)
2. Read back the file you edited end-to-end; confirm frontmatter/YAML/anchor refs unchanged
3. If you touched `extensions/xdd/*.ts`: TypeScript-check from `pi/` (`cd pi && npm run check` filtered to that path, or `npx tsc --noEmit` on the specific files)
4. If you touched `workflow/*.py`: run `python -m pytest workflow/tests/ -v` (focused) or `python -m pytest workflow/ -v` (full)

## Misc gotchas

- **No `.gitignore` in this repo.** The init commit accidentally included 23 `*.pyc` files in `workflow/__pycache__/` / `web/__pycache__/` / `web/tests/__pycache__/`. Don't blindly `git add -A` — stage explicit globs. To purge the byte-code and prevent regression, restore a root `.gitignore` first.
- `agents/xdd-walker.md` and `agents/xdd-orchestrator.md` both have a **Meta 守卫** that says: if you find yourself at the framework repo (i.e. here), do NOT load the walker/orchestrator — load these `agents/phase-*.md` directly or, for framework self-edits, skip the agent wrapper and edit `agents/`/`skills/`/`extensions/xdd/` yourself.
- `agents/agents` is a dangling symlink to `/home/zhaocj/ws/cjxdd/agents` (that path no longer exists). It's historical; safe to ignore unless debugging `install.sh`.
- `regression/runs/<ts>/trial-N/` are residual nightly-run working trees (each has its own `.git/`). Per `regression/README.md` they're auto-cleaned after 7 days, but the cleanup cron appears not to have run lately. To clear: `rm -rf regression/runs/202[5-9]*/`.
- Regression fix-verify writes to `regression-fix-<YYYYMMDD>` branch, **never** `main`. Review and merge manually.
- `workflow/web/` contains a FastAPI server + Drawflow-based UI for visualizing workflow graphs. Tests in `workflow/web/tests/`.
- `extensions/xdd/` provides the pi-coding-agent extension (runner, tools, renderers, context). This is the bridge from xdd framework to pi's agent runtime.
