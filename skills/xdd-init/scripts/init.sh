#!/usr/bin/env bash
# xdd-init/scripts/init.sh — 一键初始化 xdd 项目（三层设计锚骨架）
# 生成 .xdd/design/ + .xdd/plan/ + status.md + current-iteration
# 平台中立，无 hook 依赖。详见 skills/xdd-init/SKILL.md

set -euo pipefail

ITER=1
FORCE=false
BIZLINES=""

while [ $# -gt 0 ]; do
  case "$1" in
    --iter) ITER="$2"; shift 2 ;;
    --force) FORCE=true; shift ;;
    --bizlines) BIZLINES="$2"; shift 2 ;;
    -h|--help)
      echo "用法: bash init.sh [--iter N] [--force] [--bizlines B01-鉴权,B02-订单]"
      exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# 已存在检查（idempotent-with-warning）
if [ -d ".xdd" ] && [ "$FORCE" != "true" ]; then
  echo "❌ .xdd/ 已存在。加 --force 强制覆盖（会丢 status），或换目录。"
  exit 1
fi

mkdir -p .xdd/design/{spec,architecture,wire}
mkdir -p .xdd/plan

# current-iteration 指针
echo "iter-$ITER" > .xdd/current-iteration

# intent.md（意图锚占位，xdd-understand 填）
cat > .xdd/design/intent.md <<'EOF'
# 意图锚 — {项目名}

> 一句话：{这个项目解决什么问题，给谁，达成什么}
> xdd-understand 填写。整条 prompt→设计→代码 链的根。

## 成功标准

- {用户用了觉得"成了"的可验证事实}

## 非目标（明确不做）

- {本轮不做的}

## 谁是用户

- {主要角色 + 怎么用}

## 为什么做

- {痛点 / 现状 / 期望}
EOF

# design.md（收敛决策占位，xdd-understand 填）
cat > .xdd/design/design.md <<'EOF'
# Design — {主题}

> 收敛自发散笔记。下游 xdd-spec 只读这份。
> 5 段：Selected / Alternatives / Assumptions / Out of Scope / Open Questions

## Selected（选定方案）

- {本轮到底做什么，1-3 句}

## Alternatives（被否方案）

| 方案 | 为什么没选 |
|------|-----------|

## Assumptions（假设）

- {自主拍的默认值}

## Out of Scope（明确不做，YAGNI）

| 砍项 | 为什么本轮不做 |
|------|---------------|

## Open Questions（待用户定）

- [ ] {关键决策}
EOF

# 业务线占位（--bizlines 启用时）
if [ -n "$BIZLINES" ]; then
  cat > .xdd/design/spec/_landscape.md <<'EOF'
# 业务线 Landscape

| BXX | slug | 名称 | 定位（1 句话） |
|-----|------|------|--------------|
EOF
  IFS=',' read -ra BXX_ARR <<< "$BIZLINES"
  for bxx in "${BXX_ARR[@]}"; do
    bxx_id=$(echo "$bxx" | grep -oE 'B[0-9]+' || echo "$bxx")
    bxx_name=$(echo "$bxx" | sed "s/^${bxx_id}-//")
    slug="$bxx_id-$(echo "$bxx_name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
    echo "| $bxx_id | $slug | $bxx_name | (待填) |" >> .xdd/design/spec/_landscape.md
    mkdir -p ".xdd/design/spec/$slug"
    cat > ".xdd/design/spec/$slug/business.md" <<EOF
# $bxx_id $bxx_name ($slug)

> xdd-spec 填写。目标 + 关键问题 + 范围 + 关联。

## 业务目标
- (待填)

## 关键问题
1. (待填)

## 范围
- in-scope: (待填)
- out-of-scope: (待填)

## 关联
- RXX 规则: 见本目录 rules.md
- 架构: design/architecture/$slug/
- 韧性: design/architecture/$slug/resilience/
- 前端: design/wire/$slug/
EOF
  done
  echo "✓ spec/_landscape.md + $(echo "$BIZLINES" | tr ',' '\n' | wc -l) 业务线占位"
fi

touch .xdd/design/spec/.gitkeep
touch .xdd/design/architecture/.gitkeep
touch .xdd/design/wire/.gitkeep
touch .xdd/plan/.gitkeep

# status.md（3 层 × 业务线，✅/⏳ 简化，无 5-marker 状态机）
cat > .xdd/status.md <<EOF
# Pipeline Status — iter-$ITER

> 三层骨架：设计层（锚）→ 桥接 → 代码层。每层用 ✅/⏳ 标。
> 多业务线项目按 ## BXX 分段。

## 项目层

| 层 | 状态 | skill | 产出 |
|----|------|-------|------|
| 设计·理解 | ⏳ | xdd-understand | design/intent.md + design.md |
| 设计·规则 | ⏳ | xdd-spec | design/spec/{slug}/ rules.md + *.feature |
| 设计·架构 | ⏳ | xdd-architecture | design/architecture/{slug}/ |
| 设计·前端 | ⏳ | xdd-wire | design/wire/{page}/（纯后端跳过）|
| 设计·韧性 | ⏳ | xdd-resilience | design/architecture/{slug}/resilience/ |
| 桥接·计划 | ⏳ | xdd-plan | plan/{slug}/plan.md |
| 代码·实现 | ⏳ | xdd-execute | 代码 @implements RXX |
| 代码·验证 | ⏳ | xdd-verify | 验证报告 |

## 上下文地图

### 当前
- 层: —
- 活跃 slug: —
- 失败计数: 0

### 本层必读
- skill: —
- 输入: —
- 上游指针: —
- 自检: —
EOF

echo
echo "✅ xdd-init 完成 (iter-$ITER)"
echo
echo "=== .xdd/ 结构 ==="
find .xdd -type d | sort
echo
echo "=== 下一步 ==="
echo "对 AI 说: \"用 xdd-walker 给我做一个 <你的功能>\""
echo "walker 第一步会装 xdd-understand 写 design/intent.md + design.md"
