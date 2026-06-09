#!/bin/bash
# xdd-init/scripts/init.sh — 一键初始化 xdd 项目 (6 目录 + 业务线占位)
# 详见 skills/xdd-init/SKILL.md

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

ITER=1
FORCE=false
NO_SCALE=false
BIZLINES=""
STRICT_MODE="true"
SCHEMA_PATH=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --iter) ITER="$2"; shift 2 ;;
        --force) FORCE=true; shift ;;
        --no-scale) NO_SCALE=true; shift ;;
        --bizlines) BIZLINES="$2"; shift 2 ;;
        --strict-mode) STRICT_MODE="$2"; shift 2 ;;
        --schema) SCHEMA_PATH="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# 找 schema
if [[ -z "$SCHEMA_PATH" ]]; then
    SCHEMA_PATH="$REPO_ROOT/skills/xdd-init/templates/xdd-schema.json"
fi
if [[ ! -f "$SCHEMA_PATH" ]]; then
    SCHEMA_PATH="$HOME/.claude/skills/xdd-init/templates/xdd-schema.json"
fi

XDD_VERSION=$(python3 -c "import json; print(json.load(open('$SCHEMA_PATH'))['xdd_version'])" 2>/dev/null || echo "0.1.0")

# 已存在 check
if [[ -d ".xdd" && "$FORCE" != "true" ]]; then
    echo "❌ .xdd/ 已存在, 加 --force 强制 (危险, 会丢 status)"
    exit 1
fi

# 6 子目录创建 (老 9 子目录: 删 intent/add/business 三个, 加 00-intent 进 research/, business 工件入 bdd/)
mkdir -p .xdd/baseline/{research,bdd,flow,arch,resilience,wire}
mkdir -p .xdd/gates
mkdir -p .xdd/iterations/iter-$ITER/{pipeline,plan,design,verify,execute,chaos,wire-reviews,gate-logs,reports,research}

# gates/
echo "iter-$ITER" > .xdd/gates/current-iteration
echo "$XDD_VERSION" > .xdd/gates/xdd-version

# scale.md
if [[ "$NO_SCALE" != "true" ]]; then
    cat > .xdd/gates/scale.md <<EOF
---
project_name: $(basename $(pwd))
created: $(date -Iseconds | cut -dT -f1)
updated: $(date -Iseconds | cut -dT -f1)

# === 项目规模 ===
bizline_count: $(echo "$BIZLINES" | tr ',' '\n' | wc -l 2>/dev/null || echo 1)
total_rule_count: 50
page_count: 12
external_dep_count: 3

# === 推导 ===
scale: M

# === strict-default ===
strict_mode: $STRICT_MODE

# === 阶段触发 ===
l0_required: true
l3_required: true
l6_required: true
scaffold_required: true
bxx_enabled: $([[ -n "$BIZLINES" ]] && echo "true" || echo "false")
l3_extended_mode: true
no_advisory: true
halt_after: 3
EOF
fi

# 00-intent.md (Phase 0 写, 旧 baseline/intent/intent.md 合并入 research/)
cat > .xdd/baseline/research/00-intent.md <<EOF
# 00 - 项目意图 (Phase 0)

> 项目立项时填写. 一句话定位 + 成功标准 + 非目标. 跨迭代复用, 改后必触发 L1/L2 重审.
> v2.1 (9→6 目录合并): 此文件位置由 baseline/intent/intent.md 迁入 baseline/research/00-intent.md.

## 1 句话定位

{这个项目解决什么问题, 不解决什么问题. 不超过 30 字.}

## 成功标准

- {可度量的成功指标 1}
- {可度量的成功指标 2}
- {可度量的成功指标 3}

## 非目标 (out-of-scope)

- {明确不做的事 1}
- {明确不做的事 2}

## 关键假设

- {依赖假设 1}
- {依赖假设 2}

## 关联

- 详细业务线 landscape: \`baseline/bdd/_landscape.md\`
- 业务规则: \`baseline/bdd/{slug}/spec.md\`
EOF

# business/ → bdd/ 业务线占位 (v2 9→6 合并, BXX > 1 必填)
if [[ -n "$BIZLINES" ]]; then
    # _landscape.md (跨业务线关系, 旧 baseline/business/business-landscape.md)
    cat > .xdd/baseline/bdd/_landscape.md <<EOF
# 业务线 Landscape

> 跨业务线关系总图 — context map + 一致性约束 + 业务线上下游.
> v2.0 (9→6 目录合并): 此文件位置由 baseline/business/business-landscape.md 迁入 baseline/bdd/_landscape.md.

## 业务线列表

| BXX | 业务线名 | 目标 | 关键问题 |
|-----|---------|------|---------|
EOF
    IFS=',' read -ra BXX_ARR <<< "$BIZLINES"
    for bxx in "${BXX_ARR[@]}"; do
        bxx_id=$(echo "$bxx" | grep -oE 'B[0-9]+' || echo "$bxx")
        bxx_name=$(echo "$bxx" | sed "s/^${bxx_id}-//")
        cat >> .xdd/baseline/bdd/_landscape.md <<EOF
| ${bxx_id} | ${bxx_name} | (待填) | (待填) |
EOF
    done

    cat >> .xdd/baseline/bdd/_landscape.md <<EOF

## 跨业务线关系

(待 xdd-flow + xdd-arch 阶段填入 context map)

## 跨业务线一致性约束

- [ ] 术语一致 (RXX 业务规则)
- [ ] API 命名风格一致
- [ ] 错误码格式一致 (VLA-BXX-XXXX 风格)
- [ ] auth/authz 模型一致
- [ ] 审计日志字段一致
- [ ] multi-tenant 隔离一致
EOF

    # 每个 BXX 占位 → 迁入 bdd/{slug}/business.md
    for bxx in "${BXX_ARR[@]}"; do
        bxx_id=$(echo "$bxx" | grep -oE 'B[0-9]+' || echo "$bxx")
        bxx_name=$(echo "$bxx" | sed "s/^${bxx_id}-//")
        slug="${bxx_id}-${bxx_name}"
        mkdir -p ".xdd/baseline/bdd/${slug}"
        cat > ".xdd/baseline/bdd/${slug}/business.md" <<EOF
# ${bxx_id} ${bxx_name}

> 业务线说明 — 目标 + 关键问题 + 范围.
> v2.0 (9→6 目录合并): 旧 baseline/business/${slug}.md 迁入 baseline/bdd/${slug}/business.md.

## 业务目标

- (待 phase-researcher 阶段填)

## 关键问题

1. (待填)
2. (待填)

## 范围

- in-scope: (待填)
- out-of-scope: (待填)

## 关联

- RXX 规则: (从 ${slug}/spec.md 引用)
- Arch 设计 (含运维视图): baseline/arch/${slug}/architecture.md
- Resilience: baseline/resilience/${slug}/failure-modes.md
- 前端线框: baseline/wire/${slug}/
- 流程图: baseline/flow/${slug}.mermaid
EOF
    done

    echo "✓ baseline/bdd/: $(echo "$BIZLINES" | tr ',' '\n' | wc -l) BXX 占位 + _landscape.md 已生成 (v2 9→6 合并自 business/)"
fi

# 6 子目录 .gitkeep (老 9 目录中 intent/add/business 已删, 不再生成)
for d in research bdd flow arch resilience wire; do
    touch .xdd/baseline/$d/.gitkeep
done

# status.md (per-iter pipeline 状态)
cat > .xdd/iterations/iter-$ITER/pipeline/status.md <<EOF
# Pipeline Status — iter-$ITER

last_updated: $(date -Iseconds)
xdd_version: $XDD_VERSION
strict_mode: $STRICT_MODE

> Per-stage table below. Mark each row with ⏳ pending / 🔄 doing / ✅ done / ❌ failed.
> For multi-bizline projects, organize by \`## BXX 业务线名\` sections.

| Phase | 状态 | 备注 |
|-------|------|------|
| 0 INIT | 🔄 | .xdd/ 6 目录已生成 |
| 1 RESEARCH | ⏳ |  |
| 2 DESIGN | ⏳ |  |
| 2.5 Arch | ⏳ |  |
| 2.7 SCAFFOLD | ⏳ |  |
| 3 L3 | ⏳ |  |
| 3 Review | ⏳ |  |
| 4 Plan | ⏳ |  |
| 5 Execute | ⏳ |  |
| 6 Verify | ⏳ |  |
EOF

echo ""
echo "✅ xdd-init 完成 (iter-$ITER)"
echo ""
echo "=== .xdd/ 6 目录结构 ==="
ls -la .xdd/
echo ""
echo "=== baseline/ ($(ls .xdd/baseline | wc -l) 子目录) ==="
ls .xdd/baseline/
echo ""
echo "=== gates/ ($(ls .xdd/gates | wc -l) 文件) ==="
ls .xdd/gates/
echo ""
echo "=== iterations/iter-$ITER/ ($(ls .xdd/iterations/iter-$ITER | wc -l) 子目录) ==="
ls .xdd/iterations/iter-$ITER/
