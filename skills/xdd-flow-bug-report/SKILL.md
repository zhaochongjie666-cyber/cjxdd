---
name: xdd-flow-bug-report
description: 自动复盘 session — 从 ~/.claude/projects/{session-id}.jsonl 抽取错误 / 工具失败 / 闸门触发, 生成 .xdd/reports/bug-report-{session}.md.
  xdd 6 Phase 全程可用, Phase 6 收尾必跑. 用于: 复盘失败 session / 提取改进点 / 写入 docs/SESSION-REVIEWS/.
  触发: 复盘、session 复审、bug 报告、错误分析、postmortem、flow bug、session 审查、c3692b46 类失败复盘.
---

# xdd-flow-bug-report — Session 复盘

## 目的

读完一个 Claude Code session 的完整 jsonl, 抽出所有错误 / 工具失败 / 闸门触发 / 用户不满信号, 生成结构化 bug 报告.

**为什么需要这个 skill**: session c3692b46 失败 38% 完成, walker 蒙混 DEPLOY_PASS — 当时靠人肉看 jsonl 才发现. session 长 (> 1MB) 时人肉看不完. 这个 skill 自动化.

## 输入

| 输入 | 路径 | 说明 |
|------|------|------|
| session id | `$1` (e.g. `c3692b46-bf05-4d3d-859c-cea70d1525d2`) | 必填 |
| 上下文 | `.xdd/` 项目根 | 必填, 用于读 status.md / scale.md |

## 流程 (5 步)

### Step 1: 定位 session jsonl

```bash
SESSION_ID="${1}"
JSONL="$HOME/.claude/projects/-$(pwd | tr '/' '-' | sed 's/^-//')/${SESSION_ID}.jsonl"
# e.g. /home/zhaocj/ws/cjxdd → /home/zhaocj/.claude/projects/-home-zhaocj-ws-cjxdd/c3692b46....jsonl

[[ -f "$JSONL" ]] || { echo "[xdd] ❌ 找不到 $JSONL"; exit 1; }

SIZE=$(wc -c < "$JSONL")
LINES=$(wc -l < "$JSONL")
echo "[xdd] session: $SESSION_ID ($LINES 行, $SIZE bytes)"
```

### Step 2: 抽 5 类信号

| # | 信号 | grep 模式 |
|---|------|---------|
| 1 | **错误** (API/工具失败) | `grep -E '"type":"error"|"is_error":true|"error":' $JSONL` |
| 2 | **闸门触发** (hook 阻断) | `grep -E 'xdd-gate-\|❌\|exit 2\|exit_code":2' $JSONL` |
| 3 | **stub 痕迹** (写过的 stub) | `grep -E 'TODO\|FIXME\|NotImplementedError\|InMemoryRepository' $JSONL` |
| 4 | **压力信号** (RUSH/SKIP) | `grep -E 'RUSH\|time pressure\|skipp\|advisory\|no-advisory' $JSONL` |
| 5 | **用户不满** (打断/抱怨) | `grep -E 'wrong\|bad\|failed\|unsatisfied\|不满意\|失败\|没用' $JSONL` |

```bash
SIGNALS_FILE="/tmp/xdd-signals-${SESSION_ID}.txt"
{
    echo "=== 1. 错误 (API/工具失败) ==="
    grep -E '"type":"error"|"is_error":true' "$JSONL" | head -20

    echo ""
    echo "=== 2. 闸门触发 (hook 阻断) ==="
    grep -E 'xdd-gate-|exit 2|exit_code.*2' "$JSONL" | head -20

    echo ""
    echo "=== 3. stub 痕迹 ==="
    grep -E 'TODO|FIXME|NotImplementedError|InMemoryRepository' "$JSONL" | head -20

    echo ""
    echo "=== 4. 压力信号 (RUSH/SKIP) ==="
    grep -E 'RUSH|skipp|advisory' "$JSONL" -i | head -10

    echo ""
    echo "=== 5. 用户不满 (打断/抱怨) ==="
    grep -E '不满意|失败|没用|wrong|bad' "$JSONL" -i | head -10
} > "$SIGNALS_FILE"
```

### Step 3: 抽工具调用频次 (找"绕路"信号)

```bash
TOOL_STATS="/tmp/xdd-tools-${SESSION_ID}.txt"
grep -oE '"name":"[A-Za-z]+"' "$JSONL" | sort | uniq -c | sort -rn > "$TOOL_STATS"

# 异常信号: 同一工具被调 ≥ 10 次 (绕路)
echo "=== 异常工具调用 (≥ 10 次) ==="
awk '$1 >= 10' "$TOOL_STATS"
```

### Step 4: 抽 DEPLOY 蒙混信号

```bash
# 找声称"完成" / "DONE" / "DEPLOY_PASS" 处的上下文
DEPLOY_LIES="/tmp/xdd-deploy-lies-${SESSION_ID}.txt"
grep -B2 -A2 -E 'DEPLOY_PASS|DONE|完成|完成!|finished' "$JSONL" | head -50 > "$DEPLOY_LIES"

# 对比 status.md 实际状态
ACTUAL_STATUS=$(grep -E '^\| (0|1|2|2.5|2.7|3|4|5|6) ' .xdd/iterations/*/pipeline/status.md | head -10)
echo "=== 实际 status.md 阶段 ==="
echo "$ACTUAL_STATUS"
```

### Step 5: 写 bug report

```bash
REPORT_PATH=".xdd/reports/bug-report-${SESSION_ID}.md"
mkdir -p .xdd/reports

cat > "$REPORT_PATH" <<EOF
# Session 复盘报告: ${SESSION_ID}

**生成时间**: $(date -Iseconds)
**项目**: $(basename $(pwd))
**scale**: $(grep 'scale' .xdd/scale.md 2>/dev/null | head -1 || echo "unknown")

## 📊 Session 概况

| 指标 | 值 |
|------|-----|
| jsonl 行数 | ${LINES} |
| jsonl 大小 | ${SIZE} bytes |
| 错误数 | $(grep -c '"is_error":true' $JSONL) |
| 闸门触发 | $(grep -c 'exit_code.*2' $JSONL) |
| stub 痕迹 | $(grep -cE 'TODO|NotImplementedError|InMemoryRepository' $JSONL) |

## 🚨 5 类信号

### 1. 错误
\`\`\`
$(cat $SIGNALS_FILE | sed -n '/=== 1\./,/=== 2\./p' | head -25)
\`\`\`

### 2. 闸门触发
\`\`\`
$(cat $SIGNALS_FILE | sed -n '/=== 2\./,/=== 3\./p' | head -25)
\`\`\`

### 3-5. (省略, 见 $SIGNALS_FILE)

## 🔧 异常工具调用 (≥ 10 次, 绕路信号)

\`\`\`
$(awk '$1 >= 10' $TOOL_STATS)
\`\`\`

## 🎭 DEPLOY 蒙混信号

### 声称完成处
\`\`\`
$(head -30 $DEPLOY_LIES)
\`\`\`

### 实际 status.md
\`\`\`
${ACTUAL_STATUS}
\`\`\`

## 📋 改进建议 (skill 必填)

1. **架构层**: 哪些 phase 用了什么 skill
2. **钩子层**: 哪些 hook 该拦没拦 / 误拦
3. **skill 层**: 哪些 SKILL.md 描述不清导致 walker 偷工
4. **文档层**: CLAUDE.md / docs 哪些段缺失

EOF
echo "[xdd] ✓ 报告: $REPORT_PATH"
```

## 输出

`.xdd/reports/bug-report-{session-id}.md` (含 5 类信号 + 异常工具 + DEPLOY 蒙混 + 4 层改进建议)

## 何时用

- ✅ 跑完 demo, 复盘 session 看哪步偷工
- ✅ 用户抱怨"成果不满意"时
- ✅ Phase 6 收尾必跑 (找出 DEPLOY 蒙混点)
- ✅ 周会回顾 (取 5-10 个 session 做横向对比)

## 跟其他 skill 配合

- `xdd-status` — 先看当前 Phase 状态汇总
- `xdd-halt` — 若发现问题立即 HALT
- `docs/SESSION-REVIEWS/` — 长期归档 (commit 历史)
