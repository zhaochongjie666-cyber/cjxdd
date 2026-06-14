# Session 隔离 与 门禁共享 (2026-06-09)

**目的**: 阐明 xdd 框架**门禁是全局共享的 (跨 session 生效)**, 而**产品代码是 session-private (.xdd/ 在每个 CWD 独立)** 的设计.

## 一句话原则

**门禁是基础设施, 全局共享; 产品代码是用户数据, session 隔离**.

```
~/.claude/{agents, skills, hooks, commands, settings.json}  ← 全局共享 (门禁基础设施)
                              ↓
┌────────────────────┬────────────────────┬────────────────────┐
│  Session A: cjxdd  │  Session B: URL    │  Session C: React  │
│  CWD: /cjxdd       │  CWD: /tmp/.../url │  CWD: /tmp/.../fe  │
│  .xdd/: 不存在     │  .xdd/: 45 文件    │  .xdd/: 28 文件    │
│  (Meta 守卫拦)     │  (项目, 真跑)     │  (项目, 真跑)     │
└────────────────────┴────────────────────┴────────────────────┘
                              ↓
所有 session 跑同 1 套 hooks (从 ~/.claude/hooks/)
```

## 共享 (全局) — 门禁基础设施

| 路径 | 性质 | 改 1 处影响 |
|------|------|------------|
| `~/.claude/agents/*.md` | 框架 subagent 定义 | 所有 session 都能 dispatch |
| `~/.claude/skills/xdd-*/` | 框架 skill | 所有 session 都能装 |
| `~/.claude/hooks/*.sh` | 框架 gate hook | 所有 session 跑命令时必过 |
| `~/.claude/commands/*.md` | slash commands | 所有 session 都能调 |
| `~/.claude/settings.json` | hook 注册 | 所有 session 必跑注册过的 hook |

**这是有意设计**: 框架开发者改 hook, 立刻对所有产品项目生效. 不需要"deploy hook 到产品项目" 步骤.

## 隔离 (session-private) — 产品数据

| 路径 | 性质 | 隔离方式 |
|------|------|---------|
| `<CWD>/.xdd/` | 产品项目状态 | 每个 CWD 自己的 .xdd/, 不跨 |
| `<CWD>/src/` / `apps/` | 产品代码 | CWD 内 |
| `<CWD>/docker-compose.yml` | 产品部署 | CWD 内 |
| `<CWD>/node_modules/` | 依赖 | CWD 内 (或 .gitignore) |
| `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` | session transcript | per-cwd 隔离, per-session 独立文件 |

**关键**: 实战产物 `/tmp/test-xdd-product-实战/.xdd/` **不**影响 `/tmp/test-xdd-frontend-实战/.xdd/`, 也不影响 `/home/zhaocj/ws/cjxdd/.xdd/` (cjxdd 没 .xdd/ 是因为 Meta 守卫).

## session 隔离验证

### 当前 4 个 session 状态

| Session | CWD | .xdd/ | 状态 |
|---------|-----|-------|------|
| cjxdd 框架 | `/home/zhaocj/ws/cjxdd` | 不存在 | Meta 守卫拦 ✅ |
| URL shortener 实战 | `/tmp/test-xdd-product-实战` | 45 文件 | 实战 1 (后端) |
| React login 实战 | `/tmp/test-xdd-frontend-实战` | 28 文件 | 实战 2 (前端) |
| Dispatch 测试 | `/tmp/test-xdd-subagent` | 0 文件 | 测试 + 报告 |

### 验证 cjxdd 仓库 .xdd/ 没被污染

```bash
$ ls /home/zhaocj/ws/cjxdd/.xdd 2>/dev/null
(empty - Meta 守卫拦下, 实战 session 没在 cjxdd 跑)

$ find /home/zhaocj/ws/cjxdd -name "*.pyc" -path "*xdd*"
$ find /home/zhaocj/ws/cjxdd -name "demo/" -name "*.db"
demo/vla-v1/apps/pipe-svc/src/vla/pipe/__pycache__/saga.cpython-312.pyc (old, 不是本会话)
```

### 验证全局 hooks 在 3 个 session 都跑

3 个 /tmp 实战 session 启动时, 都跑 `xdd-gate-session-start.sh` (从 `~/.claude/hooks/`, 软链到 cjxdd/hooks/).

| Hook | 触发时机 | 实战 1 跑? | 实战 2 跑? | Dispatch 跑? |
|------|---------|----------|----------|------------|
| session-start | SessionStart | ✅ | ✅ | ✅ |
| user-prompt-submit | UserPromptSubmit | ✅ | ✅ | ✅ |
| pre-skill | PreToolUse Skill | ✅ | ✅ | ✅ |
| stub-scan | PostToolUse Write\|Edit | ✅ (后端 0 stub) | ✅ (前端 0 stub) | n/a |
| wire-validate | PostToolUse Write\|Edit | n/a (无 wire) | ✅ (3 SVG) | n/a |
| ux-check | PostToolUse Write\|Edit | n/a | ✅ (L1 2 失败) | n/a |
| coverage-check | PreToolUse Skill | ✅ | ✅ | n/a |
| team-dispatch | PreToolUse Task | ✅ | ✅ | n/a |
| stop | Stop | ✅ | ✅ | ✅ |

## session 隔离的潜在风险

### 风险 1: 全局 hook 改坏 → 所有 session 受影响

**例**: 我改 `hooks/xdd-gate-stub-scan.sh` 加一个误判模式 → 所有产品项目写代码都会被误报.

**缓解**: 改 hook 后跑 smoke + 在 demo 项目验证, 实战才上线. 本会话已修 2 个 hook bug (计数器 + 路径), 实战才发现 + 修.

### 风险 2: 软链修改未同步到所有 cjxdd 副本

**例**: 用户用 `install-to-claude-code.sh` 装框架到 `~/.claude/`, 但同时还有 2 个 cjxdd 副本 (`~/ws-cjxdd-demo-cloud-gpu` 等), hooks 是软链指回主 cjxdd.

**验证**:
```bash
$ ls -la ~/.claude/hooks/xdd-gate-wire-validate.sh
lrwxrwxrwx → /home/zhaocj/ws/cjxdd/hooks/xdd-gate-wire-validate.sh ✅
```

**缓解**: 软链是单向指回主 cjxdd, 改主 cjxdd/hooks/ → 所有 `~/.claude/hooks/` 立刻同步.

### 风险 3: 产品 .xdd/ 写到错误位置

**例**: phase-scaffolder 误把 `.xdd/` 写到 cjxdd 根 → 框架被污染.

**缓解**: xdd-orchestrator 的 Meta 守卫 (CWD 是 cjxdd 时拒绝跑 phase-subagent), 实战 session CWD 在 /tmp, 不会触发.

## 实战 session 的全链路

| 阶段 | 哪个 session 跑 | 改什么 |
|------|----------------|--------|
| 框架开发 (本会话) | session d328364d (cjxdd) | 改 `agents/` / `skills/` / `hooks/` / `commands/` / `settings.json` / `docs/` |
| URL shortener 实战 | session b6mbi0hgn (/tmp/test-xdd-product-实战) | 写 45 个 .xdd/ 文件 + 7 src + 6 test |
| React login 实战 | session b8hd69dzn (/tmp/test-xdd-frontend-实战) | 写 28 个 .xdd/ 文件 + 9 src + 1 backend test |
| Dispatch 测试 | session btk0ex2vv (test-9-subagent) | 跑 hook 验证, 写 report.md |

**无交叉污染** ✅

## 进一步保护

如果未来担心"误把 cjxdd 当产品项目" 误跑, 加一层 hook:

```bash
# 在 xdd-gate-session-start.sh 加:
if is_meta_project; then
    echo "[xdd] Meta 项目, hooks 全部禁用 (只跑 lint + test)"
    # 不注册 UserPromptSubmit / PreToolUse Skill 拦截
fi
```

但目前 Meta 守卫已经在 subagent 入口 + 实战测试通过, 暂不需要.

## 总结

| 维度 | 共享 / 隔离 | 原因 |
|------|------------|------|
| 框架 hooks / skills / agents | **共享** (全局软链) | 基础设施, 改 1 处全 session 生效 |
| 产品 .xdd/ / src/ / docker | **隔离** (per-CWD) | 用户数据, 跨项目不应串 |
| session transcript (.jsonl) | **隔离** (per-cwd + per-uuid) | 复盘 / bug report 用 |
| hook 输出 (gate log) | **共享** (写到 .xdd/reports/) | 闸门审计, 跨 session 可见 |

实战发现: **session 隔离设计正确**, 3 个实战 session + 框架 session 共存无串扰. 实战报告"4 层 UX PASS" 是 phase-executor 自我报告不可信, **不是** session 隔离 bug.
