# Codex CLI 测试指南

通过 tmux 测试 OpenAI Codex CLI 的代码生成、sandbox 执行、对话交互等行为。

## 启动

```bash
tmux send-keys -t $SESSION "cd $TEST_DIR && codex 2>${TEST_DIR}/stderr.log" Enter
```

> 注意：实际启动命令可能为 `codex` 或 `openai-codex`，根据安装方式调整。

### 启动等待

```bash
sleep 3
tmux capture-pane -t $SESSION -p -S -100 | grep -qE "codex|Codex|OpenAI|>" && echo "OK" || echo "FAIL"
```

启动时间约 2-4 秒。

## Busy 等待模式

```bash
scripts/wait-completion.sh $SESSION 120 "Working|thinking|loading|\.\.\."
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

## 断言模式

### 基本交互

```bash
assert "codex started" \
  tmux capture-pane -t $SESSION -p -S -100 | grep -qE "codex|Codex|OpenAI"

assert "AI responds" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "Hello|你好|hi|Hi"
```

### 代码生成

```bash
assert "code generated" \
  tmux capture-pane -t $SESSION -p -S -300 | grep -qE '```|function|class |def |import '
```

### Sandbox 执行

```bash
assert "sandbox executed" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "executed|ran|output|result"
```

### 文件操作

```bash
assert "file created" \
  test -f "$TEST_DIR/<expected-file>"
```

## 测试场景矩阵

| 测试项 | 测试方法 | 断言条件 |
|--------|---------|---------|
| **基本启动** | 启动 codex | TUI 显示，无报错 |
| **模型连接** | 发送简单问题 | 收到 AI 回复 |
| **代码生成** | 发送编码请求 | 输出包含代码块 |
| **Sandbox 执行** | 发送需要执行的代码 | 执行结果输出 |
| **文件操作** | 发送创建/编辑文件消息 | 文件被创建/修改 |
| **安全限制** | 发送危险操作 | 被拒绝或需确认 |

## 等待时间参考

| 操作 | 时间 |
|------|------|
| 启动 | 2-4 秒 |
| 模型响应 | 10-60 秒 |
| 代码生成 | 15-90 秒 |
| Sandbox 执行 | 5-30 秒 |

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| codex 未找到 | 未安装 | 检查 codex 安装方式 |
| 无 API key | OPENAI_API_KEY 未设置 | 检查环境变量 |
| Sandbox 权限问题 | Docker 或网络限制 | 检查 sandbox 配置 |
