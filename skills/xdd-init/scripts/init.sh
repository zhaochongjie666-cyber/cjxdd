#!/usr/bin/env bash
# xdd-init/scripts/init.sh — 一键初始化 xdd 项目（三层设计锚骨架）
# 生成 .xdd/design/ + .xdd/runs/ + status.md + current-iteration
# + inject：cp WORKFLOW.md 模板 + rules/ 模板 + 往 AGENTS.md/CLAUDE.md 注入 pointer
# 平台中立，无 hook 依赖。详见 skills/xdd-init/SKILL.md

set -euo pipefail

# 脚本自身目录（找 templates/，不依赖 CWD）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/../templates"

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

# === inject 段：WORKFLOW.md + rules/ + AGENTS.md/CLAUDE.md pointer ===
inject_xdd_section() {
  echo
  echo "=== inject xdd section ==="

  # 1. cp WORKFLOW.md 模板（framework 维护，每次覆盖）
  if [ -f "$TEMPLATES_DIR/WORKFLOW.md" ]; then
    cp "$TEMPLATES_DIR/WORKFLOW.md" .xdd/WORKFLOW.md
    echo "✓ .xdd/WORKFLOW.md"
  fi

  # 2. rules/（用户文件，已存在不覆盖；首次才写）
  if [ -f "$TEMPLATES_DIR/rules-backend.rules" ] || [ -f "$TEMPLATES_DIR/rules-ui-ux.rules" ]; then
    mkdir -p .xdd/rules
    if [ ! -f .xdd/rules/backend.rules ]; then
      cp "$TEMPLATES_DIR/rules-backend.rules" .xdd/rules/backend.rules
      echo "✓ .xdd/rules/backend.rules (首次生成)"
    else
      echo "→ .xdd/rules/backend.rules 已存在，跳过"
    fi
    if [ ! -f .xdd/rules/ui-ux.rules ]; then
      cp "$TEMPLATES_DIR/rules-ui-ux.rules" .xdd/rules/ui-ux.rules
      echo "✓ .xdd/rules/ui-ux.rules (首次生成)"
    else
      echo "→ .xdd/rules/ui-ux.rules 已存在，跳过"
    fi
  fi

  # 3. 往 AGENTS.md / CLAUDE.md 注入 pointer（用户文件，init 不创建新的）
  for f in AGENTS.md CLAUDE.md; do
    # 软链跳过（指向真文件，避免双写；真文件那次会处理）
    if [ -L "$f" ]; then
      echo "→ 跳过 $f (软链，指向 $(readlink "$f"))"
      continue
    fi
    # 不存在不创建
    if [ ! -f "$f" ]; then
      echo "→ 跳过 $f (不存在，init 不创建用户文件)"
      continue
    fi

    # 无 marker → 首次注入（插文件开头）
    if ! grep -q '<!-- xdd:start -->' "$f"; then
      tmp="$(mktemp)"
      cat "$TEMPLATES_DIR/inject-block.md" "$f" > "$tmp" && mv "$tmp" "$f"
      echo "✓ inject xdd section → $f (首次)"
      continue
    fi

    # 有 marker → 忽略空白 diff 判定是否被改过
    # 提取文件中 marker 之间的块 vs 模板，diff -w 忽略空白差异
    file_block="$(sed -n '/<!-- xdd:start -->/,/<!-- xdd:end -->/p' "$f")"
    tmpl_block="$(cat "$TEMPLATES_DIR/inject-block.md")"
    if diff -w <(printf '%s\n' "$file_block") <(printf '%s\n' "$tmpl_block") >/dev/null 2>&1; then
      echo "→ $f 注入块未改动，跳过 (idempotent)"
    else
      echo "⚠️  $f 注入块已被修改过，init 不动它（如需更新，手动删除 <!-- xdd:start -->~<!-- xdd:end --> 后重跑）"
    fi
  done
}
inject_xdd_section

echo
echo "✅ xdd-init 完成 (iter-$ITER)"
echo
echo "=== .xdd/ 结构 ==="
find .xdd -type d | sort
echo
echo "=== 下一步 ==="
echo "对 AI 说: \"用 xdd-walker 给我做一个 <你的功能>\""
echo "walker 第一步会装 xdd-understand 写 design/intent.md + design.md"
