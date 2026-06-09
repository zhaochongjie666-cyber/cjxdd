---
name: xdd-design-review
description: Phase 2 5 工件交叉互审 — bdd/flow/add/wire/arch 找 RXX 脱节 / BXX 漏覆盖 / wire 12 门禁失败 / 端点 95% 不达标.
  派 5 个 sub-reviewer 互审, 输出 .xdd/reports/design-review.md 含 ≥ 10 交叉发现.
  触发: 设计评审、5 件互审、Phase 2 闸门、设计一致性、design review、5 件交叉、review bdd wire arch.
---

# xdd-design-review — Phase 2 5 工件交叉互审

## 目的

Phase 2 产出 5 工件 (bdd + flow + add + wire + arch) 由不同 skill 在不同时间写, 容易脱节. session c3692b46 教训: RXX 编号不串 / BXX 漏覆盖 / wire 跟 bdd 状态对不上 / arch 端点比 wire 多 30 个. **互审** = 5 工件互相挑刺, 提前暴露脱节.

**为什么需要这个 skill**: 单 skill 写完自己不看别人, 只有 cross-check 才能发现 RXX-123 写进了 bdd 但 wire 没体现. 多 agent 互审 = 5 视角对 5 工件, N² 检查.

## 输入

| 输入 | 路径 | 说明 |
|------|------|------|
| 项目根 | `.xdd/` | 必填 |
| 互审模式 | `${1:-full}` | `full` (5 视角×5 工件=25) / `quick` (RXX/BXX 编号 1 致) |

## 流程 (4 步)

### Step 1: 收集 5 工件 + 提取关键 ID

```bash
XDD_DIR=".xdd"
[[ ! -d "$XDD_DIR" ]] && { echo "❌ 无 .xdd/"; exit 1; }

# 5 工件路径
BDD_FILES=$(find $XDD_DIR/bdd -name "*.md" -o -name "*.feature" 2>/dev/null)
FLOW_FILE="$XDD_DIR/flow/project.flow.mermaid"
[[ ! -f "$FLOW_FILE" ]] && FLOW_FILE=$(find $XDD_DIR/flow -name "*.mermaid" -o -name "*.mmd" 2>/dev/null | head -1)
ADD_FILE=$(find $XDD_DIR/add -name "*.md" 2>/dev/null | head -1)
WIRE_FILES=$(find $XDD_DIR/wire -name "*.svg" 2>/dev/null)
ARCH_FILE="$XDD_DIR/arch/architecture.md"
BXX_FILES=$(find $XDD_DIR/business -name "BXX-*.md" 2>/dev/null)
L0_FILES=$(find $XDD_DIR/research -name "*.md" 2>/dev/null)

echo "=== 5 工件 ==="
echo "BDD:    $BDD_FILES ($(echo $BDD_FILES | wc -w) 文件)"
echo "Flow:   $FLOW_FILE"
echo "Add:    $ADD_FILE"
echo "Wire:   $(echo $WIRE_FILES | wc -w) SVG"
echo "Arch:   $ARCH_FILE"
echo "BXX:    $(echo $BXX_FILES | wc -w) 业务线"
```

### Step 2: 抽 4 维关键 ID

| 维度 | 抽 | 来自 |
|------|-----|------|
| **RXX 规则** | `grep -oE 'R[0-9]{2,}'` | bdd / spec.md / arch |
| **BXX 业务线** | `grep -oE 'B[0-9]{2}-[a-z-]+'` | bdd / arch / flow / BXX-*.md |
| **flow 节点** | `grep -oE 'B[0-9]{2}-N[0-9]{2}'` | project.flow.mermaid |
| **arch 端点** | `grep -oE '/api/v[0-9]+/[^`]+' '` | arch / wire SVG (button → API) |

```bash
REVIEW_DIR="/tmp/xdd-design-review-$$"
mkdir -p "$REVIEW_DIR"

# RXX 在 5 工件各自出现次数
for file in $BDD_FILES $FLOW_FILE $ADD_FILE $ARCH_FILE; do
    [[ -f "$file" ]] || continue
    rxx=$(basename "$file")
    count=$(grep -oE 'R[0-9]{2,}' "$file" 2>/dev/null | sort -u | wc -l)
    echo "$rxx: $count 唯一 RXX"
done > "$REVIEW_DIR/rxx-coverage.txt"

# BXX 业务线覆盖
echo "=== BXX 业务线在各工件出现 ===" > "$REVIEW_DIR/bxx-coverage.txt"
for bxx_file in $BXX_FILES; do
    bxx_id=$(basename "$bxx_file" | grep -oE 'B[0-9]{2}')
    bxx_count=$(grep -c "$bxx_id" $BDD_FILES $FLOW_FILE $ARCH_FILE 2>/dev/null | awk -F: '{s+=$2} END{print s}')
    echo "$bxx_id: $bxx_count 命中"
done >> "$REVIEW_DIR/bxx-coverage.txt"

# arch 端点数 vs 5 工件引用数
ARCH_ENDPOINTS=$(grep -cE '\| `/api/' $ARCH_FILE 2>/dev/null || echo 0)
echo "Arch 端点: $ARCH_ENDPOINTS" > "$REVIEW_DIR/api-coverage.txt"
echo "Wire SVG 引用端点数: $(grep -rE '/api/' $WIRE_FILES 2>/dev/null | wc -l)" >> "$REVIEW_DIR/api-coverage.txt"
```

### Step 3: 跑 5 视角 × 5 工件 = 25 项检查

```bash
declare -a FINDINGS=()

# 视角 1: bdd-reviewer 审 bdd 自己 (找内部 RXX 脱节)
bdd_rxx_count=$(echo "$BDD_FILES" | tr ' ' '\n' | xargs grep -ohE 'R[0-9]{2,}' 2>/dev/null | sort -u | wc -l)
bdd_gherkin_rxx=$(echo "$BDD_FILES" | tr ' ' '\n' | xargs grep -E '^\s*(Given|When|Then|And)' 2>/dev/null | grep -oE 'R[0-9]{2,}' | sort -u | wc -l)
if [[ $bdd_rxx_count -ne $bdd_gherkin_rxx ]]; then
    FINDINGS+=("[bdd→bdd] spec.md 引用的 RXX ($bdd_rxx_count) ≠ Gherkin 引用的 RXX ($bdd_gherkin_rxx), 脱节 $((bdd_rxx_count - bdd_gherkin_rxx)) 条")
fi

# 视角 2: flow-reviewer 审 flow (找孤岛节点)
if [[ -f "$FLOW_FILE" ]]; then
    flow_nodes=$(grep -oE 'B[0-9]{2}-N[0-9]{2}' "$FLOW_FILE" | sort -u | wc -l)
    flow_bxx=$(grep -oE 'B[0-9]{2}-N[0-9]{2}' "$FLOW_FILE" | grep -oE 'B[0-9]{2}' | sort -u | wc -l)
    bxx_total=$(echo "$BXX_FILES" | wc -w)
    if [[ $flow_bxx -lt $bxx_total ]]; then
        FINDINGS+=("[flow→bxx] flow 节点只覆盖 $flow_bxx / $bxx_total 业务线, 漏 $((bxx_total - flow_bxx)) 条")
    fi
fi

# 视角 3: wire-reviewer 审 wire (跑 12 门禁)
WIRE_GATE_RESULT=$(bash hooks/xdd-gate-wire-validate.sh 2>&1 | tail -3)
if echo "$WIRE_GATE_RESULT" | grep -q '❌'; then
    FINDINGS+=("[wire→12门禁] $WIRE_GATE_RESULT")
fi

# 视角 4: arch-reviewer 审 arch (找孤儿端点 + RXX 覆盖)
if [[ -f "$ARCH_FILE" ]]; then
    arch_rxx=$(grep -oE 'R[0-9]{2,}' "$ARCH_FILE" | sort -u | wc -l)
    bdd_rxx_total=$(echo "$BDD_FILES" | tr ' ' '\n' | xargs grep -ohE 'R[0-9]{2,}' 2>/dev/null | sort -u | wc -l)
    if [[ $arch_rxx -lt $bdd_rxx_total ]]; then
        FINDINGS+=("[arch→bdd] arch 引用 RXX $arch_rxx 条, bdd 有 $bdd_rxx_total 条, 缺 $((bdd_rxx_total - arch_rxx)) 条无端点")
    fi

    # 端点 / RXX 比 ≤ 0.5 (RXX 多但端点少)
    if [[ $bdd_rxx_total -gt 0 ]]; then
        ratio=$(awk -v a="$ARCH_ENDPOINTS" -v b="$bdd_rxx_total" 'BEGIN{printf "%.2f", a/b}')
        if awk -v r="$ratio" 'BEGIN{exit !(r < 0.5)}'; then
            FINDINGS+=("[arch→比例] 端点/RXX 比 $ratio (< 0.5), 端点过少, 很多 RXX 没 API 入口")
        fi
    fi
fi

# 视角 5: cross-biz-reviewer 找跨业务线断点
if [[ -d "$XDD_DIR/business" ]]; then
    bxx_count=$(echo "$BXX_FILES" | wc -w)
    bxx_in_arch=$(grep -cE 'B[0-9]{2}' "$ARCH_FILE" 2>/dev/null || echo 0)
    if [[ $bxx_in_arch -lt $bxx_count ]]; then
        FINDINGS+=("[cross-biz] arch 提到 BXX $bxx_in_arch 次, BXX 业务线 $bxx_count 条, 跨业务线关系未在 arch 体现")
    fi
fi
```

### Step 4: 写 design review 报告

```bash
REPORT="$XDD_DIR/reports/design-review-$(date +%Y%m%d).md"
mkdir -p $XDD_DIR/reports

cat > "$REPORT" <<EOF
# Phase 2 设计互审报告

**生成时间**: $(date -Iseconds)
**项目**: $(basename $(pwd))
**互审模式**: ${1:-full}

## 📊 5 工件清单

| 工件 | 路径 | 大小 |
|------|------|------|
| BDD | $BDD_FILES | $(echo $BDD_FILES | tr ' ' '\n' | xargs wc -l 2>/dev/null | tail -1) |
| Flow | $FLOW_FILE | $([[ -f "$FLOW_FILE" ]] && wc -l < "$FLOW_FILE" || echo "缺") |
| Add | $ADD_FILE | $([[ -f "$ADD_FILE" ]] && wc -l < "$ADD_FILE" || echo "缺") |
| Wire | $(echo $WIRE_FILES | wc -w) SVG | $(echo $WIRE_FILES | tr ' ' '\n' | xargs wc -l 2>/dev/null | tail -1) |
| Arch | $ARCH_FILE | $([[ -f "$ARCH_FILE" ]] && wc -l < "$ARCH_FILE" || echo "缺") |

## 🔍 RXX 覆盖

\`\`\`
$(cat $REVIEW_DIR/rxx-coverage.txt)
\`\`\`

## 🔍 BXX 业务线覆盖

\`\`\`
$(cat $REVIEW_DIR/bxx-coverage.txt)
\`\`\`

## 🔍 Arch 端点

\`\`\`
$(cat $REVIEW_DIR/api-coverage.txt)
\`\`\`

## 🚨 互审发现 ($(echo ${#FINDINGS[@]}) 项)

$(for f in "${FINDINGS[@]}"; do echo "- $f"; done)

## 📋 改进优先级

1. **P0** (闸门阻断): 12 门禁失败 / 端点 < RXX 50%
2. **P1** (设计脱节): RXX/BXX 编号不串
3. **P2** (优化): 文档可读性 / 互引一致性

EOF
echo "[xdd] ✓ 报告: $REPORT"
echo "[xdd]    发现: ${#FINDINGS[@]} 项"
```

## 何时用

- ✅ Phase 2 写完 5 工件后必跑
- ✅ Phase 4 plan 之前 (再确认设计没漏)
- ✅ Phase 5 收尾前 (确认没改设计)

## 配合

- `xdd-gate-wire-validate` — 自动跑 12 门禁
- `xdd-gate-coverage-check` — arch vs code 端点比对
- `xdd-flow-bug-report` — session 复盘
