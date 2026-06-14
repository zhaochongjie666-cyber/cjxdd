# 平台专属层归档（2026-06-14）

这一层是 xdd 重构前的**平台耦合代码**，已整体归档，不再使用。

## 为什么删

xdd 的本质是 `用户 prompt → 设计层 → 代码实现`，设计层锚定代码不偏离用户。这套平台代码跟本质无关：

- **不可移植**：`hooks/` 是 Claude Code 的 hook 事件，`plugins/` 是 OpenCode 的 plugin SDK，两套完全不同的 API。要支持第三个平台（Cursor / pi / …）就得再写一套。
- **没真起作用**：~7300 行的"强制机器"（19 个 hook + 3 个 plugin + settings + 3 个 install 脚本）产出的 reviewer 是 sham —— 实证见仓库 memory `demo-audit-2026-06-07`（spec↔code 脱节、L6 没跑）。

## 这里有什么

| 路径 | 是什么 | 替代方案 |
|------|--------|---------|
| `hooks/` | 19 个 Claude Code `*.sh` hook（含 `xdd-gate-lib.sh` 1206 行） | 纪律回归到 skill 的文字自检段 + skill 自带可移植 bash 自检脚本 |
| `plugins/` | 3 个 OpenCode `.ts/.tsx`（`xdd-gates.ts` 3336 行等） | 同上 |
| `commands/` | Claude Code slash command（`/xdd-goal` `/xdd-halt` `/xdd-status`） | 功能回归 walker 文字行为 |
| `settings.json` | Claude Code hook 注册 | 删除（新 install.sh 不再注册 hook） |
| `prompts/` | 旧 6-phase 全量 prompt | 被新 walker（三层骨架）取代 |
| `install-to-{claude-code,opencode,pi}.sh` | 3 个平台软链脚本 | 1 个通用 `install.sh`（只软链 `agents/` + `skills/`） |

## 还能不能用

能——但这些是历史代码，不保证跟重构后的 skill/agent 兼容。需要参考闸门逻辑（stub-scan / L5 一致性 / R11）的实现时，可读这里的源码移植成可移植 bash 自检脚本。

重构说明见 `docs/` + 仓库根 `CLAUDE.md` / `README.md`。
