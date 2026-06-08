# OpenCode 测试指南

通过 tmux 测试 OpenCode 的 skill 加载、tool 调用、plugin 触发、agent 切换、doubt 系统等行为。

## 启动

```bash
tmux send-keys -t $SESSION "cd $TEST_DIR && opencode 2>${TEST_DIR}/stderr.log" Enter
```

### 启动等待

```bash
sleep 5
tmux capture-pane -t $SESSION -p -S -100 | grep -qE "opencode|Model|Agent" && echo "OK" || echo "FAIL"
```

启动时间约 3-5 秒。

## Busy 等待模式

OpenCode 完成后 TUI 会显示 prompt 输入状态，不再显示 "Working" 或 spinner：

```bash
scripts/wait-completion.sh $SESSION 120 "Working|thinking|loading"
```

或内联：

```bash
for i in $(seq 1 24); do
  sleep 5
  if ! tmux capture-pane -t $SESSION -p | grep -qE "Working|thinking|loading"; then
    echo "DONE"; break
  fi
done
```

模型响应时间 10-60 秒（取决于模型和网速）。

## 断言模式

### 基本交互

```bash
assert "opencode started" \
  tmux capture-pane -t $SESSION -p -S -100 | grep -qE "opencode|Model|Agent"

assert "AI responds" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "Hello|你好|hi|Hi"
```

### Skill 加载

```bash
assert "skill referenced" \
  tmux capture-pane -t $SESSION -p -S -300 | grep -qi "skill"
```

Skill 未触发时检查 `opencode.json` 或 `~/.config/opencode/` 下的 skill description 字段。

### Tool 调用

```bash
assert "tool used" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qE "bash|read|write|edit"
```

### Plugin 加载

检查 stderr 日志中的 plugin 初始化信息：

```bash
assert "plugin loaded" \
  grep -qi "plugin.*initialized\|DoubtPlugin" ${TEST_DIR}/stderr.log
```

### Doubt 系统

```bash
assert "doubt_add tool used" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "doubt|疑问|Added.*doubt"

assert "doubt_list shows doubts" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "doubt|疑问|Summary|Pending"
```

### Agent 切换

```bash
# Tab 切换或 /agent 命令
tmux send-keys -t $SESSION '/agent plan' Enter
sleep 3
assert "agent switched" \
  tmux capture-pane -t $SESSION -p -S -50 | grep -qiE "plan|agent"
```

### 文件操作

```bash
assert "file created" \
  test -f "$TEST_DIR/test-output.txt"
```

## 测试场景矩阵

| 测试项 | 测试方法 | 断言条件 |
|--------|---------|---------|
| **基本启动** | 启动 opencode | TUI 显示，无报错 |
| **模型连接** | 发送简单问题 | 收到 AI 回复 |
| **Skill 加载** | 发送触发 skill 的消息 | 输出中包含 skill 相关内容 |
| **Tool 调用** | 发送需要工具的消息 | 输出中包含工具执行痕迹 |
| **Plugin 加载** | 检查 stderr 日志 | plugin initialized 日志 |
| **Doubt 添加** | 发送记录疑问的消息 | doubt_add 被调用 |
| **Doubt 列表** | 发送 doubt_list | 列出已有疑问 |
| **Doubt Review** | 发送 doubt_review | 显示 review 结果 |
| **Agent 切换** | 使用 /agent 命令 | 输出中显示 agent 变更 |
| **Command 执行** | 使用 `/` 命令 | 命令正常执行 |
| **文件操作** | 发送创建/编辑文件的消息 | 文件被正确创建/修改 |

## stderr 日志

opencode 的 TUI 会拦截 console 输出。捕获 plugin 的 `console.log` 或 `client.app.log` 必须重定向 stderr：

```bash
opencode 2>/path/to/oc-stderr.log
```

## 等待时间参考

| 操作 | 时间 |
|------|------|
| opencode 启动 | 3-5 秒 |
| 模型响应 | 10-60 秒 |
| Skill 加载 | < 1 秒 |
| Plugin 初始化 | < 1 秒 |
| Tool 执行 | 1-10 秒 |

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| opencode 卡在启动 | 模型配置错误或网络问题 | 检查 `~/.config/opencode/opencode.json` |
| Skill 未触发 | description 不匹配 | 检查 skill 的 description 字段 |
| Plugin 工具未注册 | plugin 文件语法错误 | 检查 `~/.config/opencode/plugins/` 下的 TS/JS 文件 |
| Doubt 工具不可用 | doubt plugin 未加载 | 检查 plugin 安装 |
| No API key | 环境变量未设置 | 检查 `.env` 或 `~/.bashrc` 中的 API key |

## 完整测试示例

```bash
#!/bin/bash
set -e

SESSION="oc-test-$$"
TEST_DIR=$(mktemp -d)
PASS=0; FAIL=0; TOTAL=0

cleanup() {
  tmux send-keys -t $SESSION C-c C-c 2>/dev/null || true
  sleep 1
  tmux kill-session -t $SESSION 2>/dev/null || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

assert() {
  local desc="$1"; shift
  TOTAL=$((TOTAL + 1))
  if "$@" 2>/dev/null; then
    echo "PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "FAIL: $desc"; FAIL=$((FAIL + 1))
  fi
}

tmux new-session -d -s $SESSION -x 120 -y 40
tmux send-keys -t $SESSION "cd $TEST_DIR && opencode 2>${TEST_DIR}/stderr.log" Enter
sleep 5

assert "opencode started" \
  tmux capture-pane -t $SESSION -p -S -100 | grep -qE "opencode|Model|Agent"

tmux send-keys -t $SESSION 'hello' Enter
scripts/wait-completion.sh $SESSION 60 "Working|thinking|loading"

assert "AI responds" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "hello|hi|hey"

echo "Results: $PASS / $TOTAL passed, $FAIL failed"
[ $FAIL -eq 0 ] && echo "ALL TESTS PASSED" || exit 1
```

## HTTP API 测试

如果需要绕过 TUI 直接调用 OpenCode API，参考 `references/opencode-api.md`。

## Plugin API 参考

测试 OpenCode plugin 行为时，参考 `references/plugin-api.md`。
