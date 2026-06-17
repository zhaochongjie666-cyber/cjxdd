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
      echo "  --bizlines B01-x,B02-y  预生成多条业务线 spec 占位（无此参数则建默认 B01）"
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

# intent.md（意图锚占位，xdd-brainstorm 填）
cat > .xdd/design/intent.md <<'EOF'
# 意图锚 — {项目名}

> 用户为什么做这个？要解决谁的什么问题？不行的话现状痛在哪？
> 这一层是**用户审的契约**——确认对齐才往下。xdd-brainstorm 填。

## 一句话
{一句话：谁 + 做什么 + 为什么}

## 现状痛点
-

## 非目标（不做什么）
-
EOF

# design.md（收敛决策占位，xdd-brainstorm 填）
cat > .xdd/design/design.md <<'EOF'
# 收敛决策 — {项目名}

> 5 段：Selected（选定方案）/ Alternatives（考虑过没选的）/ Assumptions（假设）/
> Out of Scope（不做）/ Open Questions（待答）。xdd-brainstorm 填。

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
  # 解析 "B01-鉴权,B02-订单" → 每条建 spec/BXX-slug/business.md
  echo "$BIZLINES" | tr ',' '\n' | while IFS='-' read -r bid slug; do
    [ -z "$bid" ] && continue
    # 目录名 = BXX-slug 组合（BXX 稳定编号 + slug 可读名，如 B01-auth）
    bxx="$(echo "$bid" | grep -oE 'B[0-9]+')"
    [ -z "$bxx" ] && bxx="$bid"
    [ -z "$slug" ] && slug="$bxx"
    slug_dir="${bxx}-${slug}"
    mkdir -p ".xdd/design/spec/$slug_dir"
    cat > ".xdd/design/spec/$slug_dir/business.md" <<EOF2
# $slug_dir — 业务线占位

> 业务线占位。xdd-spec 填：目标 / 关键问题 / 范围 / 通用语言引用 / 关联。
EOF2
  done
  echo "✓ spec/_landscape.md + $(echo "$BIZLINES" | tr ',' '\n' | wc -l) 业务线占位"
else
  # 始终用 BXX：无 --bizlines 时也建默认 B01（单业务线 = 一个 BXX-slug，单→多演进零重构）
  mkdir -p .xdd/design/spec/B01-default
  cat > .xdd/design/spec/B01-default/business.md <<'EOF2'
# B01-default — 业务线占位

> 默认业务线占位（始终用 BXX-slug 结构）。xdd-spec 填：目标 / 关键问题 / 范围 / 通用语言引用 / 关联。
> 多业务线时用 `--bizlines B01-auth,B02-order` 预生成更多 BXX-slug。
EOF2
  echo "✓ spec/B01-default/ 默认业务线占位（无 --bizlines，单业务线 = B01-default）"
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
| 设计·理解 | ⏳ | xdd-brainstorm | design/intent.md + design.md |
| 设计·规则 | ⏳ | xdd-spec | design/spec/{bxx-slug}/ rules.md + *.feature |
| 设计·架构 | ⏳ | xdd-architecture | design/architecture/{bxx-slug}/ |
| 设计·前端 | ⏳ | xdd-wire | design/wire/{page}/（纯后端跳过）|
| 设计·韧性 | ⏳ | xdd-resilience | design/architecture/{bxx-slug}/resilience/ |
| 桥接·计划 | ⏳ | xdd-plan | runs/iter-$ITER/plan/{bxx-slug}/plan.md |
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

# goals.md（本 iter 的高层目标清单，per-iter；ACK 的 G 区指向下表 G 编号）
cat > ".xdd/runs/iter-$ITER/goals.md" <<EOF
# Goals — iter-$ITER

> 本 iter 要达成的高层目标。**动态追加**（用户/AI 提一条加一条）。
> ACK 的 G 区指向下表 G 编号（高层目标）；T 区指向 plan task（见 plan/{bxx-slug}/plan.md，goal 的 TDD 分解）。

| G | 目标 | 状态 | 来源 |
|---|------|------|------|
| G1 | （示例，替换为你的目标） | ⏳ | 用户 prompt |
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

  # 2b. workflows.md（用户文件，ACK W 区索引源；已存在不覆盖）
  if [ -f "$TEMPLATES_DIR/workflows.md" ]; then
    if [ ! -f .xdd/workflows.md ]; then
      cp "$TEMPLATES_DIR/workflows.md" .xdd/workflows.md
      echo "✓ .xdd/workflows.md (首次生成，ACK W 区索引源)"
    else
      echo "→ .xdd/workflows.md 已存在，跳过（用户文件保护）"
    fi
  fi

  # 3. 往 AGENTS.md / CLAUDE.md 注入 pointer（用户文件，init 不创建新的）
  for f in AGENTS.md CLAUDE.md; do
    if [ -L "$f" ]; then
      echo "→ 跳过 $f (软链，指向 $(readlink "$f"))"
      continue
    fi
    if [ ! -f "$f" ]; then
      # 全新空仓库 + AGENTS.md/CLAUDE.md 都缺：直接拼「inject 块 + 占位」一步建好 CLAUDE.md，
      # 让全局 rule + ACK 在入口就落地（iter 迁移/已有项目不建；AGENTS.md 由用户自建或软链）
      # 直接拼而不走下方 grep 分支，避免占位文案误含 marker 字面时被当成"已注入"跳过
      if [ "$f" = "CLAUDE.md" ] && [ ! -e "AGENTS.md" ] && [ "$NEW_PROJECT" = "true" ]; then
        tmp="$(mktemp)"
        cat "$TEMPLATES_DIR/inject-block.md" - > "$tmp" <<'PLACE'

# 项目说明

> 项目描述、约定、命令等写在这里（XDD 全局规则 rule 1~6 已在本文件开头）。
PLACE
        mv "$tmp" "$f"
        echo "✓ 新建最小 $f + 注入全局 rule（全新空仓库，ACK 落地）"
        continue
      else
        echo "→ 跳过 $f (不存在)"
        continue
      fi
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
  for f in .xdd/current-iteration .xdd/WORKFLOW.md .xdd/workflows.md \
           .xdd/design/intent.md .xdd/design/design.md .xdd/design/notes \
           ".xdd/runs/iter-$ITER/status.md" ".xdd/runs/iter-$ITER/goals.md" \
           ".xdd/runs/iter-$ITER/plan" ".xdd/runs/iter-$ITER/audits"; do
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
echo "walker 第一步会装 xdd-brainstorm 写 design/intent.md + design.md"
