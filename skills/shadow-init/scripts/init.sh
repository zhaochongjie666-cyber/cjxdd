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
  -h, --help         show this help

Examples:
  init.sh                              # fresh init at iter-1
  init.sh --iter 2                     # open iter-2
  init.sh --bizlines "B01 用户,B02 订单"  # multi-bizline starter status.md
USAGE
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --iter)      ITER="$2"; shift 2 ;;
        --force)     FORCE=1; shift ;;
        --schema)    SCHEMA="$2"; shift 2 ;;
        --no-scale)  GEN_SCALE=0; shift ;;
        --bizlines)  IFS=',' read -ra BIZLINES <<< "$2"; shift 2 ;;
        -h|--help)   usage ;;
        *)           echo "Unknown arg: $1"; usage; exit 1 ;;
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
if [[ -e "$SHADOW_DIR" ]]; then
    if [[ $FORCE -eq 0 ]]; then
        echo "❌  .shadow/ already exists at $SHADOW_DIR"
        echo "    Refusing to overwrite. Use --force to clobber (loses status)."
        echo "    Or use --iter N to open a new iter alongside."
        exit 1
    fi
    echo "⚠️  --force: removing existing $SHADOW_DIR"
    rm -rf "$SHADOW_DIR"
fi

# ---------- 生成 ----------
echo "🔧 Initializing Shadow project"
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

# 1. SHADOW_VERSION
echo "$SHADOW_VERSION" > "$SHADOW_DIR/SHADOW_VERSION"

# 2. current-iteration
echo "$ITER_NAME" > "$SHADOW_DIR/current-iteration"

# 3. scale.md (if not --no-scale)
if [[ $GEN_SCALE -eq 1 ]]; then
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

# 4. status.md
ISO_DATE=$(date -Iseconds 2>/dev/null || date)
HEADER="# Pipeline Status — $ITER_NAME"

# 用 printf 直接构造, 避免 $() 命令替换吃掉尾部换行
STATUS_FILE="$SHADOW_DIR/iterations/$ITER_NAME/pipeline/status.md"
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

# 5. L0-research/.gitkeep
touch "$SHADOW_DIR/L0-research/.gitkeep"

# ---------- 报告 ----------
echo "✅ Generated:"
echo "   $SHADOW_DIR/SHADOW_VERSION"
echo "   $SHADOW_DIR/current-iteration"
[[ $GEN_SCALE -eq 1 ]] && echo "   $SHADOW_DIR/scale.md"
echo "   $SHADOW_DIR/iterations/$ITER_NAME/pipeline/status.md"
echo "   $SHADOW_DIR/L0-research/.gitkeep"
echo ""
echo "📂 Created stage dirs: L0-research, L1-business, L1.5-architecture,"
echo "   L2-e2e, L5-plan, reviewer, L6-deploy (all empty, ready for outputs)"
echo ""
echo "🚀 Next steps:"
echo "   1. Load shadow-walker agent (Claude Code: 'use shadow-walker subagent')"
echo "   2. Walker reads SKILL.md of shadow-l0-research and starts L0"
echo "   3. As you write outputs, hooks auto-update status.md (⏳ → 🔄 → ✅)"
echo ""
echo "🔍 Verify with:"
echo "   cat $SHADOW_DIR/iterations/$ITER_NAME/pipeline/status.md"
echo "   cat $SHADOW_DIR/scale.md"
