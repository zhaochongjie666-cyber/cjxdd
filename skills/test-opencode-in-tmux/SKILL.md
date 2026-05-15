---
name: test-opencode-in-tmux
description: |
  OpenCode 自动化测试技能 — 通过 tmux 启动 opencode 实例，端到端测试 skill 加载、tool 调用、plugin 触发、agent 切换等行为。
  当用户说"测试 opencode"、"opencode 测试"、"test opencode"、"测试 skill"、"测试 plugin"、"测试工具"、"测试 doubt"、"验证 opencode"、"opencode 调试"、"skill 测试"、"plugin 测试"时触发此技能。
  适用于验证 opencode 的 skill 是否被正确加载、plugin 工具是否注册、doubt 系统是否正常工作、agent 是否可切换等场景。
version: 1.0.0
---

# Test OpenCode in Tmux — OpenCode 自动化测试

通过 tmux 隔离环境启动 opencode，对 skill、tool、plugin、agent 等进行端到端测试。

## 核心流程

```
创建 tmux session → 启动 opencode → 发送消息 → 等待完成 → 捕获输出 → 断言结果 → 清理
```

## 第一步：环境准备

### 1.1 创建隔离的 tmux session

```bash
tmux new-session -d -s oc-test -x 120 -y 40
```

### 1.2 准备测试工作目录

每个测试用例应使用独立的临时目录，避免状态污染：

```bash
TEST_DIR=$(mktemp -d)
```

### 1.3 启动 opencode

```bash
tmux send-keys -t oc-test "cd $TEST_DIR && opencode 2>${TEST_DIR}/oc-stderr.log" Enter
```

### 1.4 等待 opencode 启动完成

```bash
sleep 5
# 验证启动成功 — 检查 TUI 是否显示
tmux capture-pane -t oc-test -p -S -100 | grep -qE "opencode|Model|Agent" && echo "OK" || echo "FAIL"
```

## 第二步：执行测试

### 2.1 发送消息

```bash
tmux send-keys -t oc-test '你的测试消息' Enter
```

### 2.2 等待完成（轮询直到不再 busy）

opencode 完成后 TUI 会显示 prompt 输入状态，不再显示 "Working" 或 spinner：

```bash
# 每 5 秒检查一次，最多等 120 秒
for i in $(seq 1 24); do
  sleep 5
  if ! tmux capture-pane -t oc-test -p | grep -qE "Working|thinking|loading"; then
    echo "DONE"
    break
  fi
done
```

### 2.3 捕获输出

```bash
# 捕获全屏输出
tmux capture-pane -t oc-test -p -S -300 > ${TEST_DIR}/output.txt

# 捕获 stderr 日志（包含 plugin 日志）
cat ${TEST_DIR}/oc-stderr.log
```

### 2.4 断言结果

```bash
# 检查 skill 是否被加载
tmux capture-pane -t oc-test -p -S -300 | grep -qi "skill" && echo "PASS: skill referenced"

# 检查 tool 是否被调用（查看输出中是否有工具执行痕迹）
grep -q "bash\|read\|write\|edit" ${TEST_DIR}/output.txt && echo "PASS: tool used"

# 检查 doubt plugin 工具是否注册
grep -q "doubt_add\|doubt_resolve\|doubt_list" ${TEST_DIR}/output.txt && echo "PASS: doubt tool available"

# 检查 plugin 是否初始化
grep -qi "plugin.*initialized\|DoubtPlugin" ${TEST_DIR}/oc-stderr.log && echo "PASS: plugin loaded"

# 检查 AI 回复内容
grep -q "Hello\|你好\|help" ${TEST_DIR}/output.txt && echo "PASS: got response"
```

## 第三步：清理

```bash
# 中断 opencode
tmux send-keys -t oc-test C-c C-c
sleep 2
# 退出 shell
tmux send-keys -t oc-test 'exit' Enter
sleep 1
# 销毁 session
tmux kill-session -t oc-test 2>/dev/null
# 清理临时目录
rm -rf ${TEST_DIR}
```

## 完整测试模板

```bash
#!/bin/bash
set -e

SESSION="oc-test-$$"
TEST_DIR=$(mktemp -d)
PASS=0
FAIL=0

cleanup() {
  tmux send-keys -t $SESSION C-c C-c 2>/dev/null || true
  sleep 1
  tmux kill-session -t $SESSION 2>/dev/null || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

assert() {
  local desc="$1"
  shift
  if "$@"; then
    echo "✅ PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "❌ FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

# 1. 创建 session 并启动 opencode
tmux new-session -d -s $SESSION -x 120 -y 40
tmux send-keys -t $SESSION "cd $TEST_DIR && opencode 2>${TEST_DIR}/stderr.log" Enter
sleep 5

# 2. 断言：opencode 启动成功
assert "opencode started" \
  tmux capture-pane -t $SESSION -p -S -100 | grep -qE "opencode|Model|Agent"

# 3. 发送测试消息 — 测试基本回复
tmux send-keys -t $SESSION 'hello，简单回复' Enter

# 4. 等待完成
for i in $(seq 1 24); do
  sleep 5
  if ! tmux capture-pane -t $SESSION -p | grep -qE "Working|thinking|loading"; then
    break
  fi
done

# 5. 断言：收到回复
assert "got AI response" \
  tmux capture-pane -t $SESSION -p -S -100 | grep -qE "Hello|你好|hi|Hi"

# 6. 测试 skill 加载 — 发送触发 skill 的消息
tmux send-keys -t $SESSION '请帮我列出当前目录的文件' Enter

# 7. 等待完成
for i in $(seq 1 24); do
  sleep 5
  if ! tmux capture-pane -t $SESSION -p | grep -qE "Working|thinking|loading"; then
    break
  fi
done

# 8. 断言：tool 被调用
assert "tool was called" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qE "bash|read|list|ls"

# 9. 测试 doubt 工具可用性 — 通过 /tools 或发送触发 doubt 的消息
tmux send-keys -t $SESSION '记录一个疑问：这个项目的架构是否合理？优先级 high' Enter

# 10. 等待完成
for i in $(seq 1 24); do
  sleep 5
  if ! tmux capture-pane -t $SESSION -p | grep -qE "Working|thinking|loading"; then
    break
  fi
done

# 11. 断言：doubt_add 被调用
assert "doubt_add tool used" \
  tmux capture-pane -t $SESSION -p -S -200 | grep -qiE "doubt|疑问|Added.*doubt"

# 总结
echo ""
echo "========== 测试结果 =========="
echo "✅ PASS: $PASS"
echo "❌ FAIL: $FAIL"
echo "=============================="

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "完整输出已保存到: ${TEST_DIR}/output.txt"
  echo "stderr 日志: ${TEST_DIR}/stderr.log"
  exit 1
fi

echo "ALL TESTS PASSED"
```

## 测试场景矩阵

| 测试项 | 测试方法 | 断言条件 |
|--------|---------|---------|
| **基本启动** | 启动 opencode | TUI 显示，无报错 |
| **模型连接** | 发送简单问题 | 收到 AI 回复 |
| **Skill 加载** | 发送触发 skill 的消息 | 输出中包含 skill 相关内容 |
| **Tool 调用** | 发送需要工具的消息 | 输出中包含工具执行痕迹 |
| **Plugin 加载** | 检查 stderr 日志 | plugin initialized 日志 |
| **Doubt 系统** | 发送记录疑问的消息 | doubt_add 被调用 |
| **Doubt 列表** | 发送 `doubt_list` 或直接问"有什么疑问" | 列出已有疑问 |
| **Agent 切换** | 使用 Tab 键或 @agent 切换 | 输出中显示 agent 变更 |
| **Command 执行** | 使用 `/` 命令 | 命令正常执行 |
| **文件操作** | 发送创建/编辑文件的消息 | 文件被正确创建/修改 |

## 高级测试：Skill 工具链测试

### 测试 Skill 触发

```bash
# 测试 skill 是否按 description 正确触发
TEST_MESSAGES=(
  "帮我设计一个用户注册流程"           # 应触发 shadow-l1 或相关设计 skill
  "为这个接口写单元测试"                # 应触发 backend-tdd 或 frontend-test
  "跑一下测试看看覆盖率"               # 应触发 backend-tdd
  "帮我做 UX 测试"                    # 应触发 ux-test
)

for msg in "${TEST_MESSAGES[@]}"; do
  tmux send-keys -t $SESSION "$msg" Enter
  sleep 30
  output=$(tmux capture-pane -t $SESSION -p -S -200)
  echo "--- Message: $msg ---"
  echo "$output" | head -20
done
```

### 测试 Plugin 工具注册

```bash
# 通过发送消息触发 doubt 工具，验证工具链完整
TEST_DOUBT_FLOW='
1. 记录一个疑问：测试环境配置是否正确？优先级 medium
2. 再记录一个：这个方案的性能如何？优先级 low
3. 列出所有疑问
4. 解决第一个疑问
5. 忽略第二个疑问
6. 再次列出所有疑问
'

echo "$TEST_DOUBT_FLOW" | tmux send-keys -t $SESSION -l
tmux send-keys -t $SESSION Enter
```

### 测试 Agent 切换

```bash
# 测试不同 agent 的行为差异
# Build agent（默认）
tmux send-keys -t $SESSION '写一个 hello world 脚本' Enter
sleep 30

# Plan agent（Tab 切换到 plan，或 @plan）
tmux send-keys -t $SESSION '/agent plan' Enter
sleep 3
tmux send-keys -t $SESSION '分析一下这个项目的架构' Enter
sleep 30
```

## 注意事项

### stderr 日志

opencode 的 TUI 会拦截 console 输出。要捕获 plugin 的 `console.log` 或 `client.app.log` 日志，必须重定向 stderr：

```bash
opencode 2>/path/to/oc-stderr.log
```

### tmux send-keys 特殊字符

| 按键 | send-keys 语法 |
|------|---------------|
| Enter | `Enter` |
| Ctrl+C | `C-c` |
| Ctrl+D | `C-d` |
| Escape | `Escape` |
| Tab | `Tab` |
| 上箭头 | `Up` |

### 等待时间

- opencode 启动：约 3-5 秒
- 模型响应：10-60 秒（取决于模型和网速）
- Skill 加载：< 1 秒
- Plugin 初始化：< 1 秒
- Tool 执行：1-10 秒

### 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| opencode 卡在启动 | 模型配置错误或网络问题 | 检查 `~/.config/opencode/opencode.json` |
| Skill 未触发 | description 不匹配 | 检查 skill 的 description 字段 |
| Plugin 工具未注册 | plugin 文件语法错误 | 检查 `~/.config/opencode/plugins/` 下的 TS/JS 文件 |
| Doubt 工具不可用 | doubt plugin 未加载 | 运行 `./install-to-opencode.sh` |
| tmux send-keys 无响应 | session 名错误或 pane 失焦 | 检查 `tmux list-sessions` |
| No API key | 环境变量未设置 | 检查 `.env` 或 `~/.bashrc` 中的 API key |

## 脚本文件

- `scripts/wait-oc.sh` — 等待 opencode 完成当前任务的轮询脚本
- `scripts/test-opencode.sh` — 完整测试套件脚本

## 参考文件

| 文件 | 用途 | 何时读 |
|------|------|--------|
| `references/opencode-api.md` | opencode serve HTTP API 参考 | 需要直接调用 API 时 |
| `references/plugin-api.md` | OpenCode Plugin API 文档 | 测试 plugin 行为时 |
| `templates/test-template.sh` | 测试脚本模板 | 创建新测试用例时 |

## Shadow 模式集成

> 当项目使用双生暗影（Shadow）方法论管理时，本技能自动与 Shadow 体系集成。
> 如果项目根目录**不存在** `.shadow/` 目录，跳过本节，按正常测试流程执行。

### 启动检测

1. 检查项目根目录是否存在 `.shadow/CHANGELOG.md`
2. 如果存在，读取 CHANGELOG 了解当前开发状态
3. 确认当前任务对应的业务 slug

### 测试对齐

在 Shadow 模式下，测试应验证：
- L4 测试设计是否被正确执行
- L5 代码实现是否通过测试验证
- L6 部署验证是否包含自动化测试

### 非 Shadow 项目

如果 `.shadow/` 目录不存在，按本 Skill 的正常测试流程执行（向后兼容，零破坏）。
