# Pi Coding Agent 测试指南

通过 tmux 测试 Pi Coding Agent 的代码生成、工具调用、对话交互等行为。

## 启动

```bash
tmux send-keys -t $SESSION "cd $TEST_DIR && pi 2>${TEST_DIR}/stderr.log" Enter
```

### 启动等待

```bash
sleep 3
tmux capture-pane -t $SESSION -p -S -100 | grep -qE "pi|Pi|Agent|Model|Ready" && echo "OK" || echo "FAIL"
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
assert "pi agent started" \
  tmux capture-pane -t $SESSION -p -S -100 | grep -qE "pi|Pi|Agent|Ready"

assert "AI responds" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "Hello|你好|hi|Hi"
```

### 代码生成

```bash
assert "code generated" \
  tmux capture-pane -t $SESSION -p -S -300 | grep -qE '```|function|class |def |import '
```

### 工具调用

```bash
assert "tool used" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qE "bash|read|write|edit|file"
```

### 文件创建

```bash
assert "file created" \
  test -f "$TEST_DIR/<expected-file>"
```

## 测试场景矩阵

| 测试项 | 测试方法 | 断言条件 |
|--------|---------|---------|
| **基本启动** | 启动 pi | TUI 显示，无报错 |
| **模型连接** | 发送简单问题 | 收到 AI 回复 |
| **代码生成** | 发送编码请求 | 输出包含代码块 |
| **工具调用** | 发送需要工具的消息 | 工具执行痕迹 |
| **文件操作** | 发送创建/编辑文件消息 | 文件被创建/修改 |

## 等待时间参考

| 操作 | 时间 |
|------|------|
| 启动 | 2-4 秒 |
| 模型响应 | 10-60 秒 |
| 代码生成 | 15-90 秒 |
| Tool 执行 | 1-10 秒 |

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| pi 卡在启动 | 配置错误或网络问题 | 检查配置文件 |
| 无 API key | 环境变量未设置 | 检查 `.env` 或 shell profile |
| tmux send-keys 无响应 | session 名错误 | 检查 `tmux list-sessions` |
