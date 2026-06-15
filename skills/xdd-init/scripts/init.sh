#!/usr/bin/env bash
# xdd-init/scripts/init.sh — 一键初始化 xdd 项目（三层设计锚骨架）
# 生成 .xdd/design/ (持久锚) + .xdd/runs/iter-N/ (单轮工作记录) + status.md + current-iteration
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
      echo "  --iter N        iter 号（默认 1）。iter 只能前进，不能倒退。"
      echo "  --force         强制覆盖（会丢 status）。也用于绕过存量代码检测。"
      echo "  --bizlines B01-x,B02-y  预生成业务线 spec 占位"
      exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# === 存量代码检测（入口路由判定）===
detect_existing_codebase() {
  local signals=0
  for marker in package.json go.mod cargo.toml pom.xml build.gradle requirements.txt pyproject.toml composer.json Gemfile; do
    [ -f "$marker" ] && signals=$((signals+1))
  done
  for d in src app server lib api cmd internal; do
    [ -d "$d" ] && signals=$((signals+1)) && break
  done
  if [ -d ".git" ]; then
    local tracked
    tracked=$(git ls-files 2>/dev/null | grep -v '^\.xdd/' | head -1)
    [ -n "$tracked" ] && signals=$((signals+1))
  fi
  [ "$signals" -gt 0 ]
}

# === 三态分流：全新 / iter 前进迁移 / 重复或倒退 ===
NEW_PROJECT=true
if [ -d ".xdd" ]; then
  OLD_ITER="$(cat .xdd/current-iteration 2>/dev/null || echo "")"
  OLD_NUM="$(echo "$OLD_ITER" | grep -oE '[0-9]+$' || echo 0)"
  if [ "$FORCE" = "true" ]; then
    echo "⚠️  --force 强制覆盖（会丢 status）。"
    NEW_PROJECT=true
  elif [ -n "$OLD_ITER" ] && [ "$OLD_ITER" != "iter-$ITER" ] && [ "$ITER" -gt "$OLD_NUM" ]; then
    # iter 前进迁移
    NEW_PROJECT=false
    echo "=== iter 迁移：$OLD_ITER → iter-$ITER ==="
    echo "✓ 归档 $OLD_ITER（runs/$OLD_ITER/ 保留作历史，design/ 持久锚不动）"
  elif [ -n "$OLD_ITER" ] && [ "$ITER" -le "$OLD_NUM" ]; then
    echo "❌ 不能倒退或重复：当前 $OLD_ITER，你要 iter-$ITER。iter 只能前进（--iter $((OLD_NUM+1))），或 --force 强制覆盖。"
    exit 1
  else
    echo "❌ .xdd/ 已存在且就是 iter-$ITER。换 iter 号（--iter $((ITER+1))）做迁移，或 --force 强制覆盖（会丢 status）。"
    exit 1
  fi
else
  # 全新项目：存量代码检测
  if detect_existing_codebase && [ "$FORCE" != "true" ]; then
    echo "⚠️  检测到存量代码（源码目录/项目配置/git 跟踪文件）。"
    echo "   这个仓库可能已有代码。如果是遗留项目要补设计文档，应该用 xdd-reverse（反推设计 + 追溯）。"
    echo "   确认是从零 scaffold 新项目？加 --force 继续，或换 xdd-reverse。"
    exit 1
  fi
fi

# === 建目录结构 ===
# design/ 持久锚（跨 iter 保留）；runs/iter-N/ 单轮工作记录
mkdir -p .xdd/design/{spec,architecture,wire,notes}
mkdir -p ".xdd/runs/iter-$ITER/plan"
mkdir -p ".xdd/runs/iter-$ITER/audits"

# === 持久锚占位（仅全新项目写，iter 迁移保留已有）===
if [ "$NEW_PROJECT" = "true" ]; then

# intent.md（意图锚占位，xdd-understand 填）
cat > .xdd/design/intent.md <<'EOF'
# 意图锚 — {项目名}

> 用户为什么做这个？要解决谁的什么问题？不行的话现状痛在哪？
> 这一层是**用户审的契约**——确认对齐才往下。xdd-understand 填。

## 一句话
{一句话：谁 + 做什么 + 为什么}

## 现状痛点
-

## 非目标（不做什么）
-
EOF

# design.md（收敛决策占位，xdd-understand 填）
cat > .xdd/design/design.md <<'EOF'
# 收敛决策 — {项目名}

> 5 段：Selected（选定方案）/ Alternatives（考虑过没选的）/ Assumptions（假设）/
> Out of Scope（不做）/ Open Questions（待答）。xdd-understand 填。

## Selected（选定方案）
-

## Alternatives（考虑过没选）
-

## Assumptions（假设）
-

## Out of Scope（不做）
-

## Open Questions（待答）
-
EOF

# --bizlines：预生成业务线 spec 占位
if [ -n "$BIZLINES" ]; then
  cat > .xdd/design/spec/_landscape.md <<'EOF'
# 业务线全景

> 多业务线项目的限界上下文地图。xdd-spec 填。

| BXX | slug | 名称 | 定位 | 关联 |
|-----|------|------|------|------|
EOF
  # 解析 "B01-鉴权,B02-订单" → 每条建 spec/{slug}/business.md
  echo "$BIZLINES" | tr ',' '\n' | while IFS='-' read -r bid slug; do
    [ -z "$bid" ] && continue
    # slug 可能含中文，用 BXX 作目录名兜底
    biz_slug="$(echo "$bid" | grep -oE 'B[0-9]+')"
    [ -z "$biz_slug" ] && biz_slug="$bid"
    mkdir -p ".xdd/design/spec/$biz_slug"
    cat > ".xdd/design/spec/$biz_slug/business.md" <<EOF2
# $biz_slug — $slug

> 业务线占位。xdd-spec 填：目标 / 关键问题 / 范围 / 通用语言引用 / 关联。
EOF2
  done
  echo "✓ spec/_landscape.md + $(echo "$BIZLINES" | tr ',' '\n' | wc -l) 业务线占位"
fi

fi  # end NEW_PROJECT

# === gitkeep + status.md（每次都写 status；iter 迁移时写新 iter 的）===
touch .xdd/design/spec/.gitkeep
touch .xdd/design/architecture/.gitkeep
touch .xdd/design/wire/.gitkeep
touch .xdd/design/notes/.gitkeep
touch ".xdd/runs/iter-$ITER/plan/.gitkeep"
touch ".xdd/runs/iter-$ITER/audits/.gitkeep"

# status.md（本 iter 的进度，落在 runs/iter-$ITER/）
cat > ".xdd/runs/iter-$ITER/status.md" <<EOF
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
| 桥接·计划 | ⏳ | xdd-plan | runs/iter-$ITER/plan/{slug}/plan.md |
| 代码·实现 | ⏳ | xdd-execute | 代码 @implements RXX |
| 代码·验证 | ⏳ | xdd-verify | runs/iter-$ITER/verify-report.md |

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
  if [ -f "$TEMPLATES_DIR/rules-backend.rules" ] || [ -f "$TEMPLATES_DIR/rules-ui-ux.rules" ] || [ -f "$TEMPLATES_DIR/rules-frontend.rules" ]; then
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
    if [ ! -f .xdd/rules/frontend.rules ]; then
      cp "$TEMPLATES_DIR/rules-frontend.rules" .xdd/rules/frontend.rules
      echo "✓ .xdd/rules/frontend.rules (首次生成)"
    else
      echo "→ .xdd/rules/frontend.rules 已存在，跳过"
    fi
  fi

  # 3. 往 AGENTS.md / CLAUDE.md 注入 pointer（用户文件，init 不创建新的）
  for f in AGENTS.md CLAUDE.md; do
    if [ -L "$f" ]; then
      echo "→ 跳过 $f (软链，指向 $(readlink "$f"))"
      continue
    fi
    if [ ! -f "$f" ]; then
      echo "→ 跳过 $f (不存在，init 不创建用户文件)"
      continue
    fi
    if ! grep -q '<!-- xdd:start -->' "$f"; then
      tmp="$(mktemp)"
      cat "$TEMPLATES_DIR/inject-block.md" "$f" > "$tmp" && mv "$tmp" "$f"
      echo "✓ inject xdd section → $f (首次)"
      continue
    fi
    # 有 marker → 忽略空白 diff 判定是否被改过
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

# === 自检 ===
self_check() {
  echo
  echo "=== 自检 ==="
  local ok=0
  for f in .xdd/current-iteration .xdd/WORKFLOW.md \
           .xdd/design/intent.md .xdd/design/design.md .xdd/design/notes \
           ".xdd/runs/iter-$ITER/status.md" ".xdd/runs/iter-$ITER/plan" ".xdd/runs/iter-$ITER/audits"; do
    if [ -e "$f" ]; then
      echo "  ✅ $f"
    else
      echo "  ❌ 缺 $f"
      ok=1
    fi
  done
  if [ ! -d ".git" ]; then
    echo "  ⚠️  非 git 仓库（建议 git init 跟踪 .xdd/）"
  else
    echo "  ✅ git 仓库"
  fi
  if [ -f ".gitignore" ]; then
    if grep -q '.xdd/runs' .gitignore 2>/dev/null; then
      echo "  ✅ .gitignore 已含 .xdd/runs 规则"
    else
      echo "  ℹ️  提醒：.xdd/runs/iter-N/audits/ 可按需加入 .gitignore"
    fi
  fi
  for f in AGENTS.md CLAUDE.md; do
    if [ -f "$f" ] && [ ! -L "$f" ] && grep -q '<!-- xdd:start -->' "$f"; then
      echo "  ✅ $f inject marker 落地"
    fi
  done
  return $ok
}
self_check || echo "  ⚠️  自检发现问题（见上）"

# current-iteration 指针（最后写，确保结构都建好）
echo "iter-$ITER" > .xdd/current-iteration

echo
echo "✅ xdd-init 完成 (iter-$ITER)"
echo
echo "=== .xdd/ 结构 ==="
find .xdd -type d | sort
echo
echo "=== 下一步 ==="
echo "对 AI 说: \"用 xdd-walker 给我做一个 <你的功能>\""
echo "walker 第一步会装 xdd-understand 写 design/intent.md + design.md"
