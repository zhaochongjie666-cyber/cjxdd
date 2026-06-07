---
description: Start an autonomous goal-pursuit loop. Provide the goal as $ARGUMENTS.
argument-hint: <目标描述>
---

# /cjgoal — 启动自主目标循环 (Claude Code 端)

用户在 Claude Code 中调用了 `/cjgoal {目标}` (`$ARGUMENTS` 是目标文字). 这是 OpenCode `/cjgoal` 的 Claude Code 端等价 slash command, 行为对齐但**实现简化** (Claude Code 没有 TUI plugin SDK, 用 prompt-based workflow).

## 跟 OpenCode 端的差异

| 维度 | OpenCode `/cjgoal` | Claude Code `/cjgoal` |
|------|-------------------|----------------------|
| 命令注册 | TUI plugin `command.register` | `commands/cjgoal.md` slash command |
| 目标输入 | inline `/cjgoal {text}` (OpenCode 弹窗补全) | `/cjgoal {text}` 命令参数 (`$ARGUMENTS`) |
| 评估循环 | 自动: `session.idle` → 独立 evaluator session → COMPLETE/CONTINUE (10 轮 cap) | **手动**: 用户完成时再调一次 `/cjgoal done` 或写 `final.md` |
| Toast 通知 | TUI toast (`client.tui.showToast`) | 无 (Claude Code 无 TUI 弹窗 API) |
| Diag 日志 | `/tmp/goal-mode.log` JSON 行 | 无 (Claude Code hooks 可补, 见 § 进阶) |

## 行为 (当前 prompt 调 Claude 走)

1. **写目标到磁盘**:
   ```bash
   RUN_ID="cjgoal-$(date -u +%Y%m%dT%H%M%S)-$(head -c 4 /dev/urandom | xxd -p)"
   mkdir -p ".shadow/goal-runs/$RUN_ID"
   cat > ".shadow/goal-runs/$RUN_ID/goal.md" <<EOF
   # Goal

   $ARGUMENTS

   _created: $(date -u +%Y-%m-%dT%H:%M:%SZ)_
   EOF
   cat > ".shadow/goal-runs/current-goal.json" <<EOF
   { "runId": "$RUN_ID", "goal": "$ARGUMENTS", "startedAt": $(date +%s) }
   EOF
   ```

2. **告知用户**: runId 在哪, goal.md 写完.

3. **引导 walker / 当前 session 推进**:
   - 加载 `shadow-walker` subagent (或当前 agent)
   - 把 goal 内容作为 context 注入
   - 走标准 pipeline (skill / 工具调用) 推进目标
   - 每完成一个里程碑更新 goal.md (追加 ## 进展 段)

4. **完成判定** (用户触发):
   - 用户认为目标已达成 → 调 `/cjgoal done`, Claude 写 `.shadow/goal-runs/{runId}/final.md` (status: ✅ COMPLETE)
   - 用户放弃 → 调 `/cjgoal stop`, Claude 写 `final.md` (status: ❌ ABANDONED)
   - 检查进度 → 调 `/cjgoal status`, Claude 读 goal.md + final.md 汇报

## 进阶 (可选, 提升到 OpenCode 端平齐)

如果想给 Claude Code 端也加自动评估循环, 可以在 `hooks/stop-gate.sh` 末尾加:
- 检测 `.shadow/goal-runs/current-goal.json` 存在
- 调独立评估子 agent (`Task` 工具派 subagent) 判定 COMPLETE / CONTINUE
- 最多 10 轮, 超限写 `final.md` ❌ FAI3URE-CAP

需要时调 `plugins/goal-mode.tsx` 的 `evaluate()` 函数 (line 136-188) 当参考实现.

## 文件位置

- Slash command: `commands/cjgoal.md` (本文件)
- 软链目标: `~/.claude/commands/cjgoal.md` (由 `install-to-claude-code.sh` 装)
- 目标产物: `.shadow/goal-runs/{runId}/goal.md` + `current-goal.json`
