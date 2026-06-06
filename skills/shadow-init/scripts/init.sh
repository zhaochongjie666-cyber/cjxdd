#!/bin/bash
# init.sh — shadow-init 的实际执行脚本.
# 由 SKILL.md 引用, 也可独立运行: bash scripts/init.sh [args]
#
# 单文件、无外部依赖 (只要 bash + 写权限). 不需要项目里已有 .shadow/.
# shadow-schema.json 通过 readlink -f 解开软链, 找到仓库根.

set -e

SELF_REAL="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR_REAL="$(dirname "$SELF_REAL")"
# skill 目录 = .../skills/shadow-init/scripts -> 仓库根 = .../  (上 3 层)
SKILL_DIR_REAL="$(dirname "$SCRIPT_DIR_REAL")"
SKILLS_DIR_REAL="$(dirname "$SKILL_DIR_REAL")"
REPO_ROOT_REAL="$(dirname "$SKILLS_DIR_REAL")"
DEFAULT_SCHEMA="$REPO_ROOT_REAL/shadow-schema.json"

# ---------- 参数 ----------
ITER=1
FORCE=0
SCHEMA="${SHADOW_SCHEMA:-$DEFAULT_SCHEMA}"
GEN_SCALE=1
BIZLINES=()

usage() {
    cat <<'USAGE'
Usage: init.sh [options]

Options:
  --iter N           iteration name/number (default: 1)
  --force            overwrite existing .shadow/ (DANGEROUS — loses status)
  --schema PATH      path to shadow-schema.json (default: auto-detect)
  --no-scale         skip generating scale.md
  --bizlines CSV     comma-separated BXX names, e.g. "B01 用户,B02 订单"
  --archive-old      R10: 自动给老 iter evidence_archive 加 .archived 锁
                     (新 iter 启动时跑, 冻结老 iter 的证据)
  -h, --help         show this help

Examples:
  init.sh                                  # fresh init at iter-1
  init.sh --iter 2                         # open iter-2
  init.sh --iter 2 --archive-old           # open iter-2, freeze iter-1 evidence
  init.sh --bizlines "B01 用户,B02 订单"  # multi-bizline starter status.md
USAGE
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --iter)         ITER="$2"; shift 2 ;;
        --force)        FORCE=1; shift ;;
        --schema)       SCHEMA="$2"; shift 2 ;;
        --no-scale)     GEN_SCALE=0; shift ;;
        --bizlines)     IFS=',' read -ra BIZLINES <<< "$2"; shift 2 ;;
        --archive-old)  ARCHIVE_OLD=1; shift ;;
        -h|--help)      usage ;;
        *)              echo "Unknown arg: $1"; usage; exit 1 ;;
    esac
done

# ---------- 路径解析 ----------
PROJECT_ROOT="$PWD"
# 检查 .git 或 .shadow 或任意 marker 来定位项目根. 没找到就用 cwd.
while [[ "$PROJECT_ROOT" != "/" ]]; do
    if [[ -d "$PROJECT_ROOT/.git" || -d "$PROJECT_ROOT/.shadow" ]]; then
        break
    fi
    PROJECT_ROOT="$(dirname "$PROJECT_ROOT")"
done
if [[ "$PROJECT_ROOT" == "/" ]]; then
    PROJECT_ROOT="$PWD"  # 没找到 marker, 假设 cwd 就是项目根
fi

SHADOW_DIR="$PROJECT_ROOT/.shadow"

# ---------- 校验 ----------
if [[ ! -f "$SCHEMA" ]]; then
    echo "❌  schema not found: $SCHEMA"
    echo "    Set SHADOW_SCHEMA env var or use --schema PATH."
    echo "    (Default: \$REPO_ROOT/shadow-schema.json, but REPO_ROOT=$REPO_ROOT_REAL)"
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "❌  jq not found. Install it (e.g. apt install jq / brew install jq)."
    exit 1
fi

SHADOW_VERSION=$(jq -r '.shadow_version' "$SCHEMA")
if [[ -z "$SHADOW_VERSION" || "$SHADOW_VERSION" == "null" ]]; then
    echo "❌  schema missing 'shadow_version' field: $SCHEMA"
    exit 1
fi

ITER_NAME="iter-$ITER"

# 已存在检查
#   .shadow/ 不存在 → fresh init (full setup)
#   .shadow/ 存在 + --force → wipe + fresh init
#   .shadow/ 存在 + --iter N → open new iter alongside (现有 LIFECYCLE.md + 现有 iter 保留)
EXISTING_SHADOW=0
if [[ -e "$SHADOW_DIR" ]]; then
    EXISTING_SHADOW=1
    if [[ $FORCE -eq 1 ]]; then
        echo "⚠️  --force: removing existing $SHADOW_DIR"
        rm -rf "$SHADOW_DIR"
        EXISTING_SHADOW=0
    else
        echo "ℹ️  .shadow/ 存在, 走 --iter N 路径 (open new iter alongside)"
    fi
fi

# ---------- 生成 ----------
# 这些变量在 if 块外定义 (fresh + alongside 都用)
ISO_DATE=$(date -Iseconds 2>/dev/null || date)
HEADER="# Pipeline Status — $ITER_NAME"
STATUS_FILE="$SHADOW_DIR/iterations/$ITER_NAME/pipeline/status.md"

if [[ $EXISTING_SHADOW -eq 0 ]]; then
echo "🔧 Initializing Shadow project (fresh)"
echo "   project_root = $PROJECT_ROOT"
echo "   iter         = $ITER_NAME"
echo "   shadow_ver   = $SHADOW_VERSION"
echo "   schema       = $SCHEMA"
echo ""

mkdir -p "$SHADOW_DIR/iterations/$ITER_NAME/pipeline"
mkdir -p "$SHADOW_DIR/iterations/$ITER_NAME/gate"
mkdir -p "$SHADOW_DIR/L0-research"
mkdir -p "$SHADOW_DIR/L1-business"
mkdir -p "$SHADOW_DIR/L1.5-architecture"
mkdir -p "$SHADOW_DIR/L2-e2e"
mkdir -p "$SHADOW_DIR/L5-plan"
mkdir -p "$SHADOW_DIR/reviewer"
mkdir -p "$SHADOW_DIR/L6-deploy"

# 1. SHADOW_VERSION — 仅 fresh init (沿用原版本)
[[ $EXISTING_SHADOW -eq 0 ]] && echo "$SHADOW_VERSION" > "$SHADOW_DIR/SHADOW_VERSION"

# 2. current-iteration — 移出 fresh-init if 块 (无论 fresh/alongside 都要更新)
# 注: 这一行必须在 if 块外

# 3. scale.md (if not --no-scale) — 仅在 fresh init 时生成
if [[ $EXISTING_SHADOW -eq 0 && $GEN_SCALE -eq 1 ]]; then
    # 从 schema 提取默认字段, 避免在 jq 字符串里嵌 shell 变量
    SCALE_FIELDS=$(jq -r '
        "# Project Scale",
        "",
        "> 字段值由 walker 在 L1 → L1.5 之间\"规模判定\"步骤填写。",
        "> 下游 5 个 skill (l0/l1-research/l1-wire/l2/l6) 按此文件调整行为。",
        "",
        (.scale_schema.fields | to_entries | map("# \(.key): \(.value.default)") | .[])
    ' "$SCHEMA")
    {
        printf '%s\n' "$SCALE_FIELDS"
        printf 'shadow_version: %s\n' "$SHADOW_VERSION"
        printf 'last_updated: %s\n' "$ISO_DATE"
        printf '\n'
    } > "$SHADOW_DIR/scale.md"
fi

# 4. status.md — fresh init 时生成,或 open new iter 时新建 iter-N status.md
# (HEADER / ISO_DATE / STATUS_FILE 已在 if 块外定义)

# 用 printf 直接构造, 避免 $() 命令替换吃掉尾部换行
{
    printf '%s\n\n' "$HEADER"
    printf 'last_updated: %s\n' "$ISO_DATE"
    printf 'shadow_version: %s\n\n' "$SHADOW_VERSION"
    printf '> Per-stage table below. Mark each row with ⏳ pending / 🔄 doing / ✅ done / ❌ failed.\n'
    printf '> For multi-bizline projects, organize by `## BXX 业务线名` sections.\n\n'

    if [[ ${#BIZLINES[@]} -gt 0 ]]; then
        # 多业务线: 每个 BXX 一个表
        printf '## BXX 业务线占位（请用 `sed` 改名）\n\n'
        printf '(init 脚本用 --bizlines 生成的占位段. 改名前先想清楚 slug)\n\n'
        for bl in "${BIZLINES[@]}"; do
            # bl 形如 "B01 用户"; 拆出 id 和 name
            bl_id=$(echo "$bl" | awk '{print $1}')
            bl_name=$(echo "$bl" | cut -d' ' -f2-)
            printf '## %s %s\n\n' "$bl_id" "$bl_name"
            printf '| 阶段 | 状态 | 产出 | 自检 |\n'
            printf '|------|------|------|------|\n'
            printf '| L0 | ⏳ | — | — |\n'
            printf '| L1 Research | ⏳ | — | — |\n'
            printf '| L1 Flow | ⏳ | — | — |\n'
            printf '| L1 Spec | ⏳ | — | — |\n'
            printf '| L1 Wire | ⏳ | — | — |\n'
            printf '| L1.5 | ⏳ | — | — |\n'
            printf '| Scaffold | ⏳ | — | — |\n'
            printf '| L2 | ⏳ | — | — |\n'
            printf '| L5 Plan | ⏳ | — | — |\n'
            printf '| L5 Impl | ⏳ | — | — |\n'
            printf '| 全链路审查 | ⏳ | — | — |\n'
            printf '| L6 | ⏳ | — | — |\n\n'
        done
    else
        # 单业务线: 一个表
        printf '| 阶段 | 状态 | 产出 | 自检 |\n'
        printf '|------|------|------|------|\n'
        printf '| L0 | ⏳ | — | — |\n'
        printf '| L1 Research | ⏳ | — | — |\n'
        printf '| L1 Flow | ⏳ | — | — |\n'
        printf '| L1 Spec | ⏳ | — | — |\n'
        printf '| L1 Wire | ⏳ | — | — |\n'
        printf '| L1.5 | ⏳ | — | — |\n'
        printf '| Scaffold | ⏳ | — | — |\n'
        printf '| L2 | ⏳ | — | — |\n'
        printf '| L5 Plan | ⏳ | — | — |\n'
        printf '| L5 Impl | ⏳ | — | — |\n'
        printf '| 全链路审查 | ⏳ | — | — |\n'
        printf '| L6 | ⏳ | — | — |\n'
    fi
} > "$STATUS_FILE"

# 5. L0-research/.gitkeep (仅 fresh init)
[[ $EXISTING_SHADOW -eq 0 ]] && touch "$SHADOW_DIR/L0-research/.gitkeep"
fi   # 关闭 line 113 的 if [[ $EXISTING_SHADOW -eq 0 ]]

# 2.bis current-iteration (放在 fresh-init 块外, alongside 也能更新)
echo "$ITER_NAME" > "$SHADOW_DIR/current-iteration"

# 5.5 新 iter dir + status.md (无论 fresh 还是 alongside 都建)
# fresh init 时上面已经写过 status.md,这里只处理 alongside
if [[ $EXISTING_SHADOW -eq 1 ]]; then
    mkdir -p "$SHADOW_DIR/iterations/$ITER_NAME/pipeline"
    mkdir -p "$SHADOW_DIR/iterations/$ITER_NAME/gate"
    # 简化版 status.md (alongside 模式不重复 BIZLINES 模板)
    {
        printf '%s\n\n' "$HEADER"
        printf 'last_updated: %s\n' "$ISO_DATE"
        printf 'shadow_version: %s\n\n' "$SHADOW_VERSION"
        printf '> New iter alongside existing .shadow/. Walker picks up from here.\n\n'
        printf '| 阶段 | 状态 | 产出 | 自检 |\n'
        printf '|------|------|------|------|\n'
        printf '| L0 | ⏳ | — | — |\n'
        printf '| L6 | ⏳ | — | — |\n'
    } > "$STATUS_FILE"
fi

# 6. LIFECYCLE.md — 项目内生命周期索引 (Phase 2-3)
# 存在 = 新项目, 启用 R5 硬门禁;老项目(7+ 真实项目)无此文件, R5 降级 advisory
cat > "$SHADOW_DIR/LIFECYCLE.md" <<'LIFECYCLE_EOF'
# Shadow 工件生命周期 — 项目内索引

> 由 `shadow-init` 自动创建。本文件存在 = 本项目使用 Shadow 5 角色生命周期分类,R5 硬门禁启用。
> 老项目(无本文件)R5 漂移扫描降级为 advisory,详见 `skills/shadow-artifact-lifecycle/references/drift-examples.md`。

## 单一源真理

- `shadow-schema.json:lifecycle_artifacts[]` — 58 工件 × 5 角色登记
- 5 角色: design_baseline(设计基线) / process_output(过程产物) / evidence_archive(证据存档) / control_marker(控制标记) / template_instance(模板与实例)

## 5 硬门禁(由 stop-gate.sh + gate-check-lifecycle.sh 强制)

| ID | 规则 | 触发器 | 行为 |
|----|------|--------|------|
| R1 | 设计基线改动传播 | stop-gate 阶段扫描 | 24h 内 design_baseline mtime 异常 → 警告 |
| R3 | 证据写阻断 | post-write 写入时 | evidence_archive chmod 444,改前反思 |
| R5 | 漂移扫描 | stop-gate 末尾 | 实物识别率 < 80% → `exit 1`(本项目启用) |
| R6 | 路径 locality | post-write 写入时 | .shadow/ 下未登记目录 → 警告 |
| R10 | 自动 .archived 锁 | iter 冻结时(`--archive-old`) | evidence_archive 文件加 .archived 后缀 |

## 调阅入口

- **概念入口**: `CLAUDE.md § 7` 工件生命周期章节
- **元 skill**: `skills/shadow-artifact-lifecycle/SKILL.md` 可被 Walker 装卸
- **5 角色深度**: `skills/shadow-artifact-lifecycle/references/lifecycle-taxonomy.md`
- **漂移案例**: `skills/shadow-artifact-lifecycle/references/drift-examples.md`
- **vs 位置二分法**: `skills/shadow-artifact-lifecycle/references/lifecycle-vs-locality.md`
- **钩子查询**: `source hooks/lib.sh; lifecycle_role_of <path>`
- **门禁脚本**: `bash skills/shadow-artifact-lifecycle/scripts/gate-check-lifecycle.sh`

## 角色分布(本项目)

> 由 `hooks/session-start.sh` 在每次 session 启动时打印(基于 lifecycle_paths_by_role 实测)。
LIFECYCLE_EOF

# 7. R3 预保护: 给 evidence_archive 路径预 chmod 444
# 从 schema 读 evidence_archive 工件, 预创建目录 + chmod 444
evidence_archived=0
while IFS=$'\t' read -r id path; do
    [[ -z "$path" ]] && continue
    # 跳过模板路径
    case "$path" in
        skills/*) continue ;;
    esac
    # 把 {iter} {slug} {component} 去掉, 取目录部分
    gpath=$(echo "$path" | sed -E 's/\{iter\}//g; s/\{slug\}//g; s/\{component\}//g; s/\*.*$//')
    rel="${gpath#.shadow/}"
    full="$SHADOW_DIR/$rel"
    if [[ -d "$full" ]]; then
        # 已存在, 强制 chmod 444 (R3 预保护)
        find "$full" -type f ! -name "*.archived" ! -perm 444 -exec chmod 444 {} \; 2>/dev/null
        evidence_archived=$((evidence_archived+1))
    fi
done < <(jq -r '.lifecycle_artifacts.artifacts[] | select(.role == "evidence_archive") | [.id, .canonical_path] | @tsv' "$SCHEMA")
# 注: 新项目此时 .shadow/L6-deploy/{slug}/wander-evidence/ 还不存在 (要等 L6 跑), R3 主要对老项目即时生效

# 8. R10 自动 .archived 锁 (iter 冻结时) — 仅在 --archive-old 时执行
if [[ $ARCHIVE_OLD -eq 1 ]]; then
    echo ""
    echo "🔒 R10: 自动给老 iter evidence_archive 加 .archived 锁"
    # 找所有非当前 iter 的 evidence_archive 文件
    current_iter="$ITER_NAME"
    for old_iter_dir in "$SHADOW_DIR/iterations"/iter-*; do
        [[ ! -d "$old_iter_dir" ]] && continue
        old_iter_name=$(basename "$old_iter_dir")
        [[ "$old_iter_name" == "$current_iter" ]] && continue
        # 找该 iter 下的 L6-deploy/{slug}/{wander-evidence,chaos-drill-evidence,issues.json}
        old_l6="$old_iter_dir/L6-deploy"
        [[ ! -d "$old_l6" ]] && continue
        while IFS= read -r f; do
            [[ -z "$f" || "$f" == *.archived ]] && continue
            mv "$f" "${f}.archived"
            chmod 444 "${f}.archived"
            echo "   锁定: $f → .archived (chmod 444)"
        done < <(find "$old_l6" -type f \( -path "*/wander-evidence/*" -o -path "*/chaos-drill-evidence/*" -o -name "issues.json" \) 2>/dev/null)
    done
    echo "   ✓ R10 完成"
fi

# ---------- 报告 ----------
echo "✅ Generated:"
if [[ $EXISTING_SHADOW -eq 0 ]]; then
    echo "   $SHADOW_DIR/SHADOW_VERSION"
    echo "   $SHADOW_DIR/current-iteration"
    [[ $GEN_SCALE -eq 1 ]] && echo "   $SHADOW_DIR/scale.md"
    echo "   $SHADOW_DIR/L0-research/.gitkeep"
    echo "📂 Created stage dirs: L0-research, L1-business, L1.5-architecture, L2-e2e, L5-plan, reviewer, L6-deploy"
fi
echo "   $SHADOW_DIR/LIFECYCLE.md (Phase 2-3: 启用 R5 硬门禁)"
echo "   $SHADOW_DIR/iterations/$ITER_NAME/pipeline/status.md"
echo ""
echo "🔧 Mode: $(if [[ $EXISTING_SHADOW -eq 0 ]]; then echo 'fresh init'; else echo "open new iter alongside (--iter $ITER)"; fi)"
echo ""
echo "🚀 Next steps:"
echo "   1. Load shadow-walker agent (Claude Code: 'use shadow-walker subagent')"
echo "   2. Walker reads SKILL.md of shadow-l0-research and starts L0"
echo "   3. As you write outputs, hooks auto-update status.md (⏳ → 🔄 → ✅)"
echo ""
echo "🔍 Verify with:"
echo "   cat $SHADOW_DIR/iterations/$ITER_NAME/pipeline/status.md"
echo "   cat $SHADOW_DIR/scale.md"
echo "   cat $SHADOW_DIR/LIFECYCLE.md"
echo ""
if [[ $evidence_archived -gt 0 ]]; then
    echo "🔒 R3: 预 chmod 444 了 $evidence_archived 处 evidence_archive 路径"
fi
