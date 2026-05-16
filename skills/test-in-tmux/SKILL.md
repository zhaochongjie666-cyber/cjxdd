---
name: test-in-tmux
description: |
  通用 Tmux 自动化测试技能 — 通过 tmux 隔离环境启动任意 CLI 程序，端到端测试交互行为、工具调用、插件触发等。
  支持的程序包括：OpenCode、Pi Coding Agent、Cloud Code、Codex CLI 及其他可交互的命令行工具。
  当用户说"测试"、"test"、"tmux 测试"、"测试 CLI"、"测试 agent"、"测试 opencode"、"测试 pi coding agent"、
  "测试 cloud code"、"测试 codex"、"e2e 测试"、"端到端测试"、"验证程序"、"测试 skill"、"测试 plugin"、"测试工具"、
  "test in tmux"、"test agent"、"test cli tool"时触发此技能。
  适用于验证 CLI 程序的启动、交互、工具调用、插件加载、agent 切换等自动化测试场景。
  即使没有明确提到 tmux，只要需要测试 CLI 程序的交互行为，都应触发此技能。
version: "2.2.0"
---

# Test in Tmux — 通用 Tmux 自动化测试

## 角色职责

通过 tmux 隔离环境启动任意 CLI 程序，对交互行为进行端到端自动化测试。

产出测试报告（PASS/FAIL 统计），包含输出捕获和断言结果。

## 支持的程序

根据你要测试的程序，阅读对应的 reference 文件获取启动、交互、断言等详细信息：

| 程序 | Reference | 启动命令 | 典型场景 |
|------|-----------|---------|---------|
| **OpenCode** | `references/opencode.md` | `opencode` | skill 加载、tool 调用、plugin 触发、agent 切换、doubt 系统 |
| **Pi Coding Agent** | `references/pi-coding-agent.md` | `pi` | 代码生成、工具调用、对话交互 |
| **Cloud Code** | `references/cloud-code.md` | `cloud-code` | 代码生成、文件操作、对话交互 |
| **Codex CLI** | `references/codex.md` | `codex` | 代码生成、sandbox 执行、对话交互 |
| **自定义程序** | — | 用户指定 | 任意 CLI 交互测试 |

**使用方法**：读取目标程序对应的 `references/<name>.md`，获取启动参数、等待策略、输出捕获、断言模式等全部细节。测试自定义程序时，直接使用下面的通用流程。

## 核心流程

```
创建 tmux session → 启动目标程序 → 发送交互 → 等待完成 → 捕获输出 → 断言结果 → 清理
```

所有程序共享这套流程，差异仅在启动命令、等待策略和断言模式上。

## 执行步骤

### 首次执行

1. **创建隔离环境** → 创建 tmux session 和临时测试目录
2. **启动目标程序** → 根据 reference 文件中的启动命令启动
3. **等待就绪** → 轮询检查程序是否启动完成
4. **发送交互** → 发送测试消息或命令
5. **等待完成** → 轮询检查程序是否处理完成
6. **捕获输出** → 保存 tmux pane 输出和 stderr 日志
7. **断言结果** → 检查输出是否包含期望内容
8. **清理环境** → 终止程序、删除临时目录

### 修改模式

**触发条件**：已有测试需要调整（新增用例、修改断言、调试失败）

**操作步骤**：
1. 读取已有测试脚本
2. 根据需求修改启动命令、交互内容或断言
3. 重新运行测试
4. 对比前后输出，确认修改有效

## 第一步：环境准备

### 1.1 创建隔离的 tmux session

```bash
SESSION="test-$(basename $0)-$$"
tmux new-session -d -s $SESSION -x 120 -y 40
```

### 1.2 准备测试工作目录

每个测试用例应使用独立的临时目录，避免状态污染：

```bash
TEST_DIR=$(mktemp -d)
```

### 1.3 启动目标程序

根据 `references/<name>.md` 中的启动命令启动目标程序。通用模式：

```bash
tmux send-keys -t $SESSION "cd $TEST_DIR && <启动命令> 2>${TEST_DIR}/stderr.log" Enter
```

### 1.4 等待程序就绪

不同程序的启动时间和就绪标志不同，参考对应的 reference 文件。通用方法：

```bash
sleep <启动等待时间>
tmux capture-pane -t $SESSION -p -S -100 | grep -qE "<就绪标志>" && echo "OK" || echo "FAIL"
```

## 第二步：执行测试

### 2.1 发送交互

```bash
tmux send-keys -t $SESSION '测试消息' Enter
```

### 2.2 等待完成

**推荐使用内联轮询**，不依赖外部脚本：

```bash
# 内联轮询（推荐）
for i in $(seq 1 $((max / 5))); do
  sleep 5
  if ! tmux capture-pane -t $SESSION -p | grep -qE "<busy-pattern>"; then
    break
  fi
done
```

> 禁止使用外部脚本（如 `scripts/wait-completion.sh`），所有轮询逻辑必须内联实现，以便于调试和维护。

### 2.3 捕获输出

```bash
tmux capture-pane -t $SESSION -p -S -300 > ${TEST_DIR}/output.txt
cat ${TEST_DIR}/stderr.log
```

### 2.4 断言结果

```bash
# 通用断言函数
assert() {
  local desc="$1"; shift
  if "$@" 2>/dev/null; then
    echo "PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "FAIL: $desc"; FAIL=$((FAIL + 1))
  fi
}

assert "描述" tmux capture-pane -t $SESSION -p -S -200 | grep -qi "expected"
```

## 第三步：清理

```bash
tmux send-keys -t $SESSION C-c C-c
sleep 2
tmux send-keys -t $SESSION 'exit' Enter
sleep 1
tmux kill-session -t $SESSION 2>/dev/null
rm -rf ${TEST_DIR}
```

## 完整测试模板

使用 `templates/test-template.sh` 创建新测试。核心骨架：

```bash
#!/bin/bash
set -e

SESSION="test-$(basename $0)-$$"
TEST_DIR=$(mktemp -d)
PASS=0; FAIL=0; TOTAL=0
APP="<app-name>"
LOG="${TEST_DIR}/stderr.log"

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

# === 读取 references/${APP}.md 获取启动命令和断言模式 ===

# === Setup ===
tmux new-session -d -s $SESSION -x 120 -y 40
tmux send-keys -t $SESSION "cd $TEST_DIR && <启动命令> 2>${LOG}" Enter
sleep 5

# === Your Tests ===

# === Summary ===
echo ""
echo "Results: $PASS / $TOTAL passed, $FAIL failed"
[ $FAIL -eq 0 ] && echo "ALL TESTS PASSED" || exit 1
```

## tmux send-keys 特殊按键

| 按键 | send-keys 语法 |
|------|---------------|
| Enter | `Enter` |
| Ctrl+C | `C-c` |
| Ctrl+D | `C-d` |
| Escape | `Escape` |
| Tab | `Tab` |
| 上箭头 | `Up` |

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 程序卡在启动 | 配置错误或网络问题 | 检查配置文件和环境变量 |
| tmux send-keys 无响应 | session 名错误或 pane 失焦 | 检查 `tmux list-sessions` |
| 输出捕获为空 | 等待时间不够 | 增大轮询超时 |
| No API key | 环境变量未设置 | 检查 `.env` 或 shell profile |

## 脚本文件

> **已废弃**：不建议使用外部脚本，所有逻辑应内联实现。

| 脚本 | 状态 | 用途 |
|------|------|------|
| `scripts/wait-completion.sh` | ❌ 不推荐 | 通用等待完成轮询脚本 |
| `scripts/run-test.sh` | ❌ 不推荐 | 通用测试运行器 |

## 参考文件索引

按需读取目标程序的 reference，不要一次加载全部。

| 文件 | 用途 | 何时读 |
|------|------|--------|
| `references/opencode.md` | OpenCode 测试指南 | 测试 OpenCode 时 |
| `references/opencode-api.md` | OpenCode HTTP API 参考 | 需要 OpenCode API 时 |
| `references/plugin-api.md` | OpenCode Plugin API 文档 | 测试 OpenCode plugin 时 |
| `references/pi-coding-agent.md` | Pi Coding Agent 测试指南 | 测试 Pi Coding Agent 时 |
| `references/cloud-code.md` | Cloud Code 测试指南 | 测试 Cloud Code 时 |
| `references/codex.md` | Codex CLI 测试指南 | 测试 Codex 时 |
| `templates/test-template.sh` | 通用测试脚本模板 | 创建新测试用例时 |

## 关键约束

- **每个测试用例必须使用独立的临时目录**，避免状态污染
- **测试完成后必须清理 tmux session**，防止资源泄漏
- **必须使用内联轮询**，禁止依赖外部脚本进行等待
- **等待时间应合理设置**，过短会导致输出捕获不完整，过长会浪费时间
- **断言应该具体明确**，避免模糊匹配导致误判
- 测试失败时应保存输出文件，便于调试分析

## Shadow 模式集成

> 当项目使用双生暗影（Shadow）方法论管理时，本技能自动与 Shadow 体系集成。
> 如果项目根目录**不存在** `.shadow/` 目录，跳过本节，按正常测试流程执行。

### 启动检测

1. 检查项目根目录是否存在 `.shadow/CHANGELOG.md`
2. 如果存在，读取 CHANGELOG 了解当前开发状态
3. 确认当前任务对应的业务 slug

### 测试对齐

在 Shadow 模式下，测试应验证：
- Harness 计划测试断言是否被正确执行
- L5 代码实现是否通过测试验证
- L6 部署验证是否包含自动化测试

### 非 Shadow 项目

如果 `.shadow/` 目录不存在，按本 Skill 的正常测试流程执行（向后兼容，零破坏）。
