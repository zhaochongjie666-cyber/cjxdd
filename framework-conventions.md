# Framework Conventions

> **xdd 框架自身（cjxdd 仓库）维护时的操作习惯。**
> 跟产品项目的 `.xdd/core/` 同源思路：用户意图是真相之源，AI 不能擅删。

## 1. wire 设计习惯

1. **wire 放在 `.xdd/wire/` 目录下**（原 shadow 时代的 L1-wire 目录已废弃）。
   - 跟 `.xdd/bdd/` / `.xdd/add/` 平级
   - 相关 group 页面单独一个 svg（如登录流程：`login-flow.desktop.svg` + `login-flow.mobile.svg`）
2. **用户最友好的操作**：
   - `input` + `selector`（最稳定的交互范式）
   - 不依赖 mouse 坐标 / 复杂 key 序列

## 2. skill / agent / hook 命名

### 2.1 skill 命名
- 全部带 `xdd-` 前缀
- 不用 `shadow-` 命名（已废弃归档到 `archive/shadow-2026-06/`，90 天后删除）
- 核心 13 个 (v2.0 9→6 合并: xdd-add 已并入 xdd-arch § 12 运维视图)：`xdd-core` / `xdd-bdd` / `xdd-flow` / `xdd-wire` / `xdd-arch` / `xdd-scaffold` / `xdd-l0` / `xdd-l3` / `xdd-l6` / `xdd-plan` / `xdd-execute` / `xdd-init` / `xdd-artifact-lifecycle`
- utility 也带前缀：`xdd-taste` / `xdd-mermaid-check` / `xdd-docker-helper` / `xdd-skill-creator` 等

### 2.2 agent 命名
- 全部带 `xdd-` 前缀
- 当前：`xdd-walker` (CC/OC 通用) / `xdd-walker-pi` (pi 协议变体)
- 旧的 `shadow-walker` / `shadow-worker` 已废弃

### 2.3 hook 命名
- 全部带 `xdd-gate-` 前缀
- 11 个 gate：`xdd-gate-{meta,0-init,1-research,2-design,3-review,4-plan,5-execute,6-verify,pre-skill,stub-scan,session-start,stop,user-prompt-submit,team-dispatch,pressure}` (实际 14 个包含全部 hook)
- 旧 `lib.sh` / `pre-skill.sh` 等已废弃

### 2.4 plugin 命名
- `plugins/xdd-gates.ts` (合并 shadow-hooks.ts + back-cover.ts)
- `plugins/xdd-goal.tsx` (替代 goal-mode.tsx)
- `plugins/xdd-meta.ts` (显式 Meta 守卫, 供 settings 配)

### 2.5 prompt 命名
- `prompts/xdd_full.md` (替代 ai-execution-prompt.md)
- `prompts/xdd-team-loop.md` (替代 team_loop.md)

## 3. 工件目录

- **产品项目**: `.xdd/`
- **framework 自身**: git 仓库（`/home/zhaocj/ws/cjxdd/`）
- **不创建** `.shadow/`（已废弃）

## 4. 顶层配置

| 旧 | 新 |
|----|----|
| `settings.json` (shadow hook paths) | `settings.json` (xdd-gate-* paths) |
| `core.md` (122 字节 wire 方针) | `framework-conventions.md` (本文件, 扩写) |
| `docs/SHADOW-WORKFLOW.md` (411 行) | `docs/WORKFLOW.md` (xdd 6 Phase 总览) |
| `commands/cjgoal.md` | `commands/xdd-goal.md` |
| `docs/work-order-template.md` | `docs/xdd/PLAN-TEMPLATE.md` |

## 5. install 脚本

- `install-to-claude-code.sh` (重写: 源路径 `skills/shadow-*` → `skills/xdd-*`)
- `install-to-opencode.sh` (重写: 同样源路径)
- `install-to-pi.sh` (重写: 同样源路径)
- 软链目标路径不变（`~/.claude/` / `~/.config/opencode/` / `~/.pi/`）

## 6. scale.md 字段

- 产品项目 `.xdd/scale.md` 必含 `strict_mode: true` (默认)
- 5 个下游 skill 读这个字段不读 scale 标签
- 降级必须显式（改字段，不改 scale 标签）

## 7. Meta 项目边界

**这个项目就是 xdd 框架自身。**

- ❌ 不要加载 `xdd-walker` agent 来开发本仓库（会污染 `.xdd/`）
- ❌ 不要跑 xdd 流水线
- ❌ 不要在本仓库创建 `.xdd/`
- ❌ 不要用 `xdd-init` / `xdd-l0` 等 skill "调研" framework 自身
- ❌ 不要被 `xdd-gate-user-prompt-submit.sh` 引导"加载 walker 给我做一个 XX 系统"
- ✅ 直接 Read/Edit 改 `agents/` / `skills/` / `hooks/` / `plugins/` / `commands/` 源码
- ✅ 改完跑对应 smoke 验证
- ✅ 直接 commit (Conventional Commits, 末尾 Co-Authored-By)
- ✅ 想"用 framework 验证 framework" → 仓库外另起产品项目

## 8. 防御式 hook 旁路

`hooks/xdd-gate-user-prompt-submit.sh` 加 Meta 旁路：当前 CWD 是 cjxdd 仓库自身时，**不触发** "build me X" → walker 加载引导。详见 `hooks/xdd-gate-lib.sh:is_meta_project()`。

`agents/xdd-walker.md` / `xdd-walker-pi.md` 顶部都加了 "Meta 守卫" 段，加载时先检测 project root，若是 cjxdd 自身，立即拒绝执行并提示用户直接改源码。
