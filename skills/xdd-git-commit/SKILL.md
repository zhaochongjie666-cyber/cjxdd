---
name: xdd-git-commit
description: |
  生成 Conventional Commits 规范的 git commit 并提交. 分析已暂存(staged)的改动,
  自动推断 type/scope/描述, 组装规范的 commit message, 然后执行 git commit.
  触发: 提交代码、commit、写个 commit、帮我提交、生成 commit message、
  提交信息、git commit、规范提交、conventional commit、提交一下、总结改动并提交.
  也覆盖"看看我改了什么然后提交"、"给这些改动写个 message"等隐式触发.
---

# Git Commit — Conventional Commits 规范提交助手

## 何时用

> **何时用本 skill**：用户想提交代码（已 `git add` 或让我一起暂存），需要一条规范的 commit message。
> **何时不该用**：用户只是想看 diff 不提交（直接 `git diff` 即可）；或想撤销/回滚提交（那是另一个动作）。

## 怎么做

```
commit():
  staged = git_diff_staged()
  if empty(staged):
      suggest_what_to_stage()          # 别对着空 index 硬写
      return
  msg = compose_message(staged)        # type + scope + 描述 + body
  show(msg)                             # 给用户过目
  git_commit(msg)
  show(result: 分支 + 提交摘要)
```

1. **看改动** —— `git diff --staged`（加上 `--stat` 先看轮廓）。
2. **若暂存区空** —— 不要硬编 message。看 `git status`，问/建议用户要暂存哪些文件。
3. **组装 message** —— 按 Conventional Commits 推断 type/scope/描述，必要时加 body。
4. **过目** —— 把最终 message 完整展示给用户（多行原样，含 footer）。
5. **提交** —— 执行 `git commit`，回显分支名 + 提交摘要。

## 1. 采集改动

先看轮廓再看细节，避免被大 diff 淹没：

```bash
git diff --staged --stat     # 改了哪些文件、增删行数
git diff --staged            # 具体内容
```

如果用户还没暂存，但明显想提交当前工作区改动：

```bash
git status --short           # 看 modified / untracked
```

然后**询问或按惯例**决定暂存范围。**不要自作主张 `git add -A`** —— 尤其当有大量 untracked 文件或可疑的临时文件（`.env`、`*.log`、`dist/`）。有疑虑就问。若仓库根有 `.gitignore`，新增的产物文件通常已被忽略，untracked 出现的多半是要纳入版本控制的真实改动。

## 2. Conventional Commits 格式

```
<type>(<scope>): <description>

<body — 可选, 解释 why / 列要点>

<footer — 可选, BREAKING CHANGE: / refs / co-author>
```

### Type（按改动性质选，只选一个）

| type | 用于 |
|------|------|
| `feat` | 新功能（用户可见的新能力） |
| `fix` | bug 修复 |
| `docs` | 文档（README、注释、markdown） |
| `style` | 格式（空格、分号等，不改逻辑） |
| `refactor` | 重构（既非加功能也非修 bug） |
| `perf` | 性能优化 |
| `test` | 加/改测试 |
| `build` | 构建系统、依赖（package.json、Dockerfile 等） |
| `ci` | CI 配置 |
| `chore` | 杂项维护（不属上面任何一类） |
| `revert` | 撤销某次提交 |

判断要点：**问"这次改动对使用者/下游意味着什么"**。新增能力 → `feat`；修复错误行为 → `fix`；只动文字 → `docs`/`style`；改结构不变行为 → `refactor`。拿不准时优先 `refactor`/`chore`，别为了"听起来重要"就塞 `feat`。

### Scope（可选，但推荐）

表示改动的**范围/模块**，小写、连字符分隔。从改动文件路径自然推断：

- 改 `skills/xdd-spec/` → `scope = spec`
- 改 `auth/login.ts` + `auth/token.ts` → `scope = auth`
- 跨多个不相关模块 → **省略 scope**，别硬凑一个骗人的统称

### Description

- **祈使句、现在时、小写开头**：`add password reset` ✅ / `Added password reset` ❌
- **结尾不加句号**
- **说"做了什么"，不说"改了什么文件"**：`add password reset flow` ✅ / `update auth.ts` ❌
- **≤50 字符**最理想，硬上限 72

### Body（可选）

当改动**需要解释 why**、或**有多个要点**时加 body。一个清楚的 `fix(auth): reject expired tokens` 不需要 body。

- 每行 ≤72 字符
- 用 `-` 列要点说明 what/why，而不是 how
- 解释**动机**（为什么这么改），diff 已经说明了 how

### Footer（可选）

- **破坏性变更**：`BREAKING CHANGE: <说明>`（或描述末尾加 `!`，如 `feat(api)!: drop v1 endpoints`）
- **引用 issue/PR**：`Refs #123` / `Closes #123` / `See #456`
- **co-author**：如果有协作贡献者，按仓库惯例加

## 3. 自检清单

提交前过一遍，这是质量闸，不是摆设：

- [ ] type 选对了？（对应改动的**性质**，不是"听起来像 feat"）
- [ ] scope 是从文件路径真实推断的？跨无关模块就省略？
- [ ] description 是祈使句、小写、≤72 字符、没句号？
- [ ] message 说了"做了什么"，而不是"改了哪个文件"？
- [ ] body 只在该解释 why 时才加？加了就解释**动机**而非 how？
- [ ] 没有 `git add -A` 把临时文件/产物一起塞进去？
- [ ] 完整 message 已给用户过目？

## 4. 执行提交

组装好的 message 用**多个 `-m`** 传，每个 `-m` 是一段（标题 / body / footer），git 会自动用空行分隔：

```bash
git commit -m "feat(auth): add password reset flow" \
           -m "- Add forgot password form
- Implement email verification
- Wire up reset endpoint" \
           -m "Closes #142"
```

避免用 `git commit` 不带 `-m` 进交互编辑器（脚本/harness 环境里会卡住）。也别把多段塞进一个 `-m` 里手敲 `\n\n` —— 多个 `-m` 更干净。

提交后回显：

```bash
git log -1 --stat          # 分支 + 提交摘要 + 改动文件
```

告诉用户：分支名、commit hash、提交标题、改了哪些文件。让用户一眼确认提交对了。

## 5. 示例

**简单（单文件、单一意图）：**

```
Input:  修改了 README 里一处错别字
Output: docs: fix typo in README
```

**中等（一个模块的多点改动，需要 body 解释 why）：**

```
Input:  登录模块加了密码重置表单 + 邮箱验证 + 重置接口
Output:
feat(auth): add password reset flow

- Add forgot password form
- Implement email verification
- Wire up reset endpoint

Closes #142
```

**重构（不改行为）：**

```
Input:  把 auth 模块里的回调风格重构成 async/await
Output:
refactor(auth): switch token validation to async/await
```

**修复：**

```
Input:  修复了 token 过期后还能继续访问的问题
Output:
fix(auth): reject expired tokens on protected routes
```

**跨多模块（省略 scope）：**

```
Input:  升级了一堆依赖 + 改了 CI 配置
Output:
chore: bump dependencies and update CI matrix
```

## 边界情况

- **暂存区为空** → 别编 message。看 `git status`，建议暂存范围或问用户。
- **改动太多、type 不止一种** → 建议用户**拆成多个提交**（`feat:` 一条、`fix:` 一条），每个提交单一意图。一条 commit 塞 5 种改动 = 以后 `git bisect` 和 review 的噩梦。
- **有未跟踪文件** → 先判断该不该纳入版本控制（看 `.gitignore`、看文件性质）。可疑就问，别默认 `git add -A`。
- **用户在 Meta 仓库（如本 framework 自身 `cjxdd`）** → 遵守该仓库的 commit 约定。如 `AGENTS.md` 规定的 `Co-Authored-By` footer，按规矩加，不要漏。
- **husky / pre-commit hook 失败** → 把 hook 输出原样给用户，不要绕过（如 `--no-verify`）。修问题，不是绕检查。

## 自检

本 skill 只依赖 `git` 标准命令（`diff` / `status` / `add` / `commit` / `log`），无平台 hook / plugin / 平台专属命令。

验证方式：跑 framework-conventions.md §5 的零平台耦合检查（`agents/` + `skills/` 排除 archive 期望 0 命中）。

> 本技能为通用工具，与项目工作区兼容（不创建需要溯源的业务产物，不依赖 `.xdd/` 工作区）。
