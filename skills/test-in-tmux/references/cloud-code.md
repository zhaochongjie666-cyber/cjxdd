# Cloud Code 测试指南

通过 tmux 测试 Google Cloud Code 的代码生成、文件操作、对话交互等行为。

## 启动

```bash
tmux send-keys -t $SESSION "cd $TEST_DIR && cloud-code 2>${TEST_DIR}/stderr.log" Enter
```

> 注意：实际启动命令可能为 `cloud-code`、`gcloud code` 或 `gemini`，根据安装方式调整。

### 启动等待

```bash
sleep 3
tmux capture-pane -t $SESSION -p -S -100 | grep -qE "Cloud Code|Gemini|Ready|>" && echo "OK" || echo "FAIL"
```

启动时间约 2-5 秒。

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
assert "cloud-code started" \
  tmux capture-pane -t $SESSION -p -S -100 | grep -qE "Cloud Code|Gemini|Ready"

assert "AI responds" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "Hello|你好|hi|Hi"
```

### 代码生成

```bash
assert "code generated" \
  tmux capture-pane -t $SESSION -p -S -300 | grep -qE '```|function|class |def |import '
```

### 文件操作

```bash
assert "file created" \
  test -f "$TEST_DIR/<expected-file>"
```

## 测试场景矩阵

| 测试项 | 测试方法 | 断言条件 |
|--------|---------|---------|
| **基本启动** | 启动 cloud-code | TUI 显示，无报错 |
| **模型连接** | 发送简单问题 | 收到 AI 回复 |
| **代码生成** | 发送编码请求 | 输出包含代码块 |
| **文件操作** | 发送创建/编辑文件消息 | 文件被创建/修改 |
| **认证** | 检查启动日志 | 认证成功无报错 |

## 等待时间参考

| 操作 | 时间 |
|------|------|
| 启动 | 2-5 秒 |
| 模型响应 | 10-60 秒 |
| 代码生成 | 15-90 秒 |
| Tool 执行 | 1-10 秒 |

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 认证失败 | gcloud 未登录 | 运行 `gcloud auth login` |
| 无 API key | 项目未配置 | 检查 GCP 项目和 API 启用状态 |
| 启动命令未找到 | 未安装 | 检查 cloud-code 安装方式 |
