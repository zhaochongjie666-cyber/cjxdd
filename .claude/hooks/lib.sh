#!/bin/bash
# lib.sh — Shared utilities for Shadow hook scripts.
# Sourced by other hooks. Pure functions + cached lookups, no side effects on stdout.
#
# IMPORTANT: lib.sh functions always `return 0` on the "no result" path so
# they are safe to call under `set -e` in parent scripts. Callers check the
# output (empty = not found) rather than the exit code.

# Resolve the project root (the directory containing .shadow/ or .git/).
# Walks up from $PWD. Returns empty if not found.
find_project_root() {
    local dir="${PWD}"
    while [[ "$dir" != "/" ]]; do
        if [[ -d "$dir/.shadow" || -d "$dir/.git" ]]; then
            echo "$dir"
            return 0
        fi
        dir=$(dirname "$dir")
    done
    return 1
}

# Returns the absolute path to .shadow/ in the project, or empty.
get_shadow_dir() {
    local root
    root=$(find_project_root) || { echo ""; return 0; }
    if [[ -d "$root/.shadow" ]]; then
        echo "$root/.shadow"
    fi
    echo ""
}

# Returns the current iteration name (e.g. "iter-2"), or empty.
get_current_iter() {
    local shadow
    shadow=$(get_shadow_dir)
    if [[ -n "$shadow" && -f "$shadow/current-iteration" ]]; then
        cat "$shadow/current-iteration"
    fi
    echo ""
}

# Returns absolute path to current status.md, or empty.
get_status_md() {
    local shadow iter
    shadow=$(get_shadow_dir)
    [[ -z "$shadow" ]] && { echo ""; return 0; }
    iter=$(get_current_iter)
    [[ -z "$iter" ]] && { echo ""; return 0; }
    local f="$shadow/iterations/$iter/pipeline/status.md"
    if [[ -f "$f" ]]; then
        echo "$f"
    fi
    echo ""
}

# Echoes a one-line summary of pipeline state:
#   "iter-2 | L0 ✅ L1-R ✅ L1-F 🔄 ... | 0 fail"
# Returns empty if no status.md.
read_status_summary() {
    local md
    md=$(get_status_md) || return 0
    [[ ! -f "$md" ]] && return 0

    local iter
    iter=$(get_current_iter)

    # Pull stage rows from the markdown table.
    # Stage column contains ✅ / 🔄 / ⏳ / ❌
    local done=0 inprog=0 pending=0 failed=0
    while IFS='|' read -r _ stage status _ _; do
        stage=$(echo "$stage" | xargs)
        [[ -z "$stage" || "$stage" == "阶段" ]] && continue
        case "$status" in
            *✅*) done=$((done + 1)) ;;
            *🔄*) inprog=$((inprog + 1)) ;;
            *❌*) failed=$((failed + 1)) ;;
            *⏳*) pending=$((pending + 1)) ;;
        esac
    done < <(grep -E '^\|\s*L' "$md" 2>/dev/null)

    echo "$iter | done=$done in_progress=$inprog pending=$pending failed=$failed"
}

# Echoes per-bizline pipeline breakdown (one line per ## BXX section).
# Output format:
#   ## B01 用户管理 | done=2 in_progress=1 pending=0 failed=0
#   ## B02 订单管理 | done=0 in_progress=0 pending=3 failed=0
# Returns empty if no status.md or no ## BXX sections (single-bizline falls
# back to read_status_summary).
read_bxx_breakdown() {
    local md
    md=$(get_status_md)
    [[ -z "$md" || ! -f "$md" ]] && return 0

    awk -v FS='|' '
        function flush() {
            if (section != "" && (done + inprog + pending + failed) > 0) {
                printf "  %s | done=%d in_progress=%d pending=%d failed=%d\n", \
                    section, done, inprog, pending, failed
            }
        }
        BEGIN { section = ""; done=inprog=pending=failed=0 }
        /^## B[0-9]/ {
            flush()
            section = $0
            sub(/^## +/, "", section)
            done = inprog = pending = failed = 0
            next
        }
        /^\| *L[0-9]/ {
            status = $3
            gsub(/^ +| +$/, "", status)
            if (status ~ /✅/) done++
            else if (status ~ /🔄/) inprog++
            else if (status ~ /❌/) failed++
            else if (status ~ /⏳/) pending++
        }
        END { flush() }
    ' "$md"
}

# Echoes pending/in-progress stages grouped by BXX (for stop-gate).
# Output format:
#   ## B01 用户管理
#     - L1 Spec ⏳
#     - L1 Wire ⏳
#   ## B02 订单管理
#     - L0 ⏳
# Returns empty if no status.md or no pending stages.
read_pending_stages() {
    local md
    md=$(get_status_md)
    [[ -z "$md" || ! -f "$md" ]] && return 0

    awk -v FS='|' '
        function flush(   i) {
            if (section == "" || pending_count == 0) return
            printf "  %s\n", section
            for (i = 1; i <= pending_count; i++) {
                printf "    - %s\n", pending[i]
            }
        }
        BEGIN { section = ""; pending_count = 0; delete pending }
        /^## B[0-9]/ {
            flush()
            section = $0
            sub(/^## +/, "", section)
            pending_count = 0
            delete pending
            next
        }
        /^\| *L[0-9]/ {
            stage = $2; gsub(/^ +| +$/, "", stage)
            status = $3; gsub(/^ +| +$/, "", status)
            if (status ~ /⏳/ || status ~ /🔄/) {
                pending[++pending_count] = stage " " status
            }
        }
        END { flush() }
    ' "$md"
}

# Scans given directories for Shadow "stub" anti-patterns.
# Echoes "<file>:<line>: <pattern>" lines, capped at $1 (default 20).
# Directories passed via stdin (one per line).
scan_stub_patterns() {
    local cap="${1:-20}"
    local dirs
    dirs=$(cat)

    [[ -z "$dirs" ]] && return 0

    # Patterns from Walker hard rule #1 (no stubs) + #2 (no fake impls).
    # Anchored to look like real statements, not strings inside a comment/docstring.
    grep -rEn \
        -e '^\s*pass\s*$' \
        -e 'TODO' \
        -e 'FIXME' \
        -e 'raise NotImplementedError' \
        -e 'InMemoryRepository' \
        -e 'InMemoryEventBus' \
        -e 'current_user\s*=\s*["'"'"']admin["'"'"']' \
        --include="*.py" --include="*.ts" --include="*.tsx" \
        --include="*.js" --include="*.jsx" --include="*.go" \
        --include="*.java" --include="*.kt" --include="*.rs" \
        $dirs 2>/dev/null \
        | grep -vE '/(\.venv|node_modules|__pycache__|dist|build|\.git|target)/' \
        | head -n "$cap"
}

# Scans a single file for stub patterns. Used by the PostToolUse hook to
# give immediate feedback on each Write/Edit.
# Args: $1 = file path. Optional $2 = cap (default 10).
# Echoes "<file>:<line>: <matched-line>" lines.
scan_stub_in_file() {
    local file="${1:-}"
    local cap="${2:-10}"

    [[ -z "$file" || ! -f "$file" ]] && return 0
    # Skip binary / oversized / non-source files.
    [[ ! -r "$file" ]] && return 0
    local size
    size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
    [[ "$size" -gt 524288 ]] && return 0   # > 512KB, skip

    # Only scan recognized source extensions (avoid hitting .md, .txt, .json noise).
    case "$file" in
        *.py|*.ts|*.tsx|*.js|*.jsx|*.go|*.java|*.kt|*.rs) ;;
        *) return 0 ;;
    esac

    # Reuse the same anti-patterns. Note: `grep -E` on a single file (not -r).
    grep -En \
        -e '^\s*pass\s*$' \
        -e 'TODO' \
        -e 'FIXME' \
        -e 'raise NotImplementedError' \
        -e 'InMemoryRepository' \
        -e 'InMemoryEventBus' \
        -e 'current_user\s*=\s*["'"'"']admin["'"'"']' \
        "$file" 2>/dev/null \
        | head -n "$cap"
}

# Find likely source directories under project root.
# Excludes build/venv dirs. Echoes absolute paths, one per line.
find_source_dirs() {
    local root
    root=$(find_project_root) || { echo ""; return 0; }
    find "$root" -maxdepth 4 -type d \
        \( -name "src" -o -name "lib" -o -name "app" -o -name "backend" \
           -o -name "frontend" -o -name "server" -o -name "internal" \) \
        -not -path "*/node_modules/*" -not -path "*/.venv/*" \
        -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/target/*" \
        2>/dev/null
}

# ─────────── Stage 表 (与 OpenCode shadow-flow plugin 对齐) ───────────
# 用安全的 ASCII alias (避免 bash 数组 key 兼容性问题, 特别是中文/CJK 字符)
# alias: status.md 中可能出现的显示名 (带空格或中文) → 内部 ID
# 内部 ID 用下划线代替空格
STAGE_ALIAS_L0="L0"
STAGE_ALIAS_L1_RESEARCH="L1 Research"
STAGE_ALIAS_L1_FLOW="L1 Flow"
STAGE_ALIAS_L1_SPEC="L1 Spec"
STAGE_ALIAS_L1_WIRE="L1 Wire"
STAGE_ALIAS_L1P5="L1.5"
STAGE_ALIAS_SCAFFOLD="Scaffold"
STAGE_ALIAS_L2="L2"
STAGE_ALIAS_L5_PLAN="L5 Plan"
STAGE_ALIAS_L5_IMPL="L5 Impl"
STAGE_ALIAS_REVIEWER="全链路审查"
STAGE_ALIAS_L6="L6"
STAGE_ALIAS_L6_FIX="L6 漫游修复"

# 内部 ID → skill 名映射 (用 _ 代替空格, 安全)
declare -A STAGE_SKILL=(
    ["L0"]="shadow-l0-research"
    ["L1_Research"]="shadow-l1-research"
    ["L1_Flow"]="shadow-l1-flow"
    ["L1_Spec"]="shadow-l1-spec"
    ["L1_Wire"]="shadow-l1-wire"
    ["L1.5"]="shadow-l1p5-architecture"
    ["Scaffold"]="shadow-scaffold"
    ["L2"]="shadow-l2-e2e"
    ["L5_Plan"]="shadow-l5-plan"
    ["L5_Impl"]="shadow-l5-impl"
    ["Reviewer"]="shadow-reviewer"
    ["L6"]="shadow-l6-deploy"
)
declare -A STAGE_NUM=(
    ["L0"]=0
    ["L1_Research"]=1
    ["L1_Flow"]=2
    ["L1_Spec"]=3
    ["L1_Wire"]=4
    ["L1.5"]=5
    ["Scaffold"]=6
    ["L2"]=7
    ["L5_Plan"]=8
    ["L5_Impl"]=9
    ["Reviewer"]=10
    ["L6"]=11
)
declare -A STAGE_SKILL_NUM=(
    [shadow-l0-research]=0
    [shadow-l1-research]=1
    [shadow-l1-flow]=2
    [shadow-l1-spec]=3
    [shadow-l1-wire]=4
    [shadow-l1p5-architecture]=5
    [shadow-scaffold]=6
    [shadow-l2-e2e]=7
    [shadow-l5-plan]=8
    [shadow-l5-impl]=9
    [shadow-reviewer]=10
    [shadow-l6-deploy]=11
)
# 每个 stage 的预期产物路径 (相对于项目根, glob 风格)
# 用于 L4 检测 + L5 漂移检查
declare -A STAGE_OUTPUTS=(
    ["L0"]=".shadow/L0-research/*.md"
    ["L1_Research"]=".shadow/L1-business/{slug}/intent.md .shadow/L1-business/{slug}/business-landscape.md"
    ["L1_Flow"]=".shadow/L1-business/project.flow.mermaid"
    ["L1_Spec"]=".shadow/L1-business/{slug}/spec.md"
    ["L1_Wire"]=".shadow/L1-business/{slug}/wireframes/*.svg"
    ["L1.5"]=".shadow/L1.5-architecture/{slug}/architecture.md"
    ["Scaffold"]="Dockerfile"
    ["L2"]=".shadow/L2-e2e/{slug}/uat-script.md"
    ["L5_Plan"]=".shadow/L5-plan/{slug}/harness-plan.md"
    ["L5_Impl"]="src/**/*"
    ["Reviewer"]=".shadow/reviewer/{slug}/review-report.md"
    ["L6"]=".shadow/L6-deploy/{slug}/deploy-report.md"
)

# alias 标准化: "L1 Research" / "L1\ Research" / "L1_Research" 全部归一到内部 ID
# Args: $1 = display name from status.md
# Returns: internal ID (e.g. "L1_Research") or empty
stage_alias_to_id() {
    local name="$1"
    case "$name" in
        "L0") echo "L0" ;;
        "L1 Research"|"L1_Research") echo "L1_Research" ;;
        "L1 Flow"|"L1_Flow") echo "L1_Flow" ;;
        "L1 Spec"|"L1_Spec") echo "L1_Spec" ;;
        "L1 Wire"|"L1_Wire") echo "L1_Wire" ;;
        "L1.5") echo "L1.5" ;;
        "Scaffold") echo "Scaffold" ;;
        "L2") echo "L2" ;;
        "L5 Plan"|"L5_Plan") echo "L5_Plan" ;;
        "L5 Impl"|"L5_Impl") echo "L5_Impl" ;;
        "全链路审查") echo "Reviewer" ;;
        "L6"|"L6 漫游修复") echo "L6" ;;
        *) echo "" ;;
    esac
}

# 找 status.md 中第一个 ⏳ stage 的显示名
# Returns: display name (e.g. "L1 Spec") or empty
detect_pending_stage() {
    local md
    md=$(get_status_md)
    [[ -z "$md" || ! -f "$md" ]] && { echo ""; return 0; }
    awk -F'|' '
        /^\| *L/ {
            stage=$2; gsub(/^ +| +$/, "", stage)
            status=$3; gsub(/^ +| +$/, "", status)
            if (status ~ /⏳/) { print stage; exit }
        }
    ' "$md"
}

# 找 status.md 中第一个 🔄 stage (正在做)
# Returns: display name or empty
detect_doing_stage() {
    local md
    md=$(get_status_md)
    [[ -z "$md" || ! -f "$md" ]] && { echo ""; return 0; }
    awk -F'|' '
        /^\| *L/ {
            stage=$2; gsub(/^ +| +$/, "", stage)
            status=$3; gsub(/^ +| +$/, "", status)
            if (status ~ /🔄/) { print stage; exit }
        }
    ' "$md"
}

# 在 status.md 中找下一个 stage (当前 ⏳/🔄 之后的)
# Returns: display name or empty
next_stage_after() {
    local current="$1"
    local found_current=0
    local md
    md=$(get_status_md)
    [[ -z "$md" || ! -f "$md" ]] && { echo ""; return 0; }
    while IFS='|' read -r _ stage status _ _; do
        stage=$(echo "$stage" | xargs)
        status=$(echo "$status" | xargs)
        [[ -z "$stage" || "$stage" == "阶段" ]] && continue
        if [[ $found_current -eq 1 && "$status" == *"⏳"* ]]; then
            echo "$stage"
            return 0
        fi
        if [[ "$stage" == "$current" ]]; then
            found_current=1
        fi
    done < <(grep -E '^\|\s*L' "$md" 2>/dev/null)
    echo ""
}

# 把 status.md 中某个 stage 的 mark 改成新值
# Args: $1=stage display name, $2=new mark (⏳ / 🔄 / ✅)
# 用 sed 做原地修改, 写回原文件
update_stage_status() {
    local stage="$1"
    local new_mark="$2"
    local md
    md=$(get_status_md)
    [[ -z "$md" || ! -f "$md" ]] && return 1
    # 行形如: | L1 Spec | ✅ DONE | ...
    # 替换第 3 列 (status) 为新 mark
    # 用 awk 更安全
    local tmp
    tmp=$(mktemp)
    awk -F'|' -v stage="$stage" -v new_mark="$new_mark" '
        $0 ~ "^\\| *\\<" stage "\\> *\\|" {
            # 第 3 列替换
            print $1 "|" $2 "| " new_mark " |" $4 "|" $5
            next
        }
        { print }
    ' "$md" > "$tmp" && mv "$tmp" "$md"
    return 0
}

# 根据文件路径反查它属于哪个 stage 的预期产物
# Args: $1 = 绝对路径
# Returns: stage internal ID (e.g. "L1_Research") or empty
match_stage_by_output() {
    local file_path="$1"
    local root
    root=$(find_project_root) || return 1
    [[ -z "$root" ]] && return 1
    # 转成相对路径
    local rel="${file_path#$root/}"
    [[ "$rel" == "$file_path" ]] && return 1  # 不在项目内

    # 遍历每个 stage 的 patterns, 用 bash case 通配
    for stage in "${!STAGE_OUTPUTS[@]}"; do
        local patterns="${STAGE_OUTPUTS[$stage]}"
        for pat in $patterns; do
            # 把 {slug} 替换成 *, * 保留
            # 例: ".shadow/L1-business/{slug}/intent.md" → ".shadow/L1-business/*/intent.md"
            local glob_pat="${pat//\{slug\}/*}"
            # 也把 path 中的 . 转义
            glob_pat=$(printf '%s' "$glob_pat" | sed 's|/|/|g')  # 保留 / 字符, 不转义
            # case glob 匹配
            # shellcheck disable=SC2254
            case "$rel" in
                $glob_pat) echo "$stage"; return 0 ;;
            esac
        done
    done
    echo ""
}

# 把 skill 名转 stage 内部 ID
# Args: $1 = skill name
# Returns: stage internal ID (e.g. "L1_Research") or empty
skill_to_stage() {
    local skill="$1"
    for stage in "${!STAGE_SKILL[@]}"; do
        if [[ "${STAGE_SKILL[$stage]}" == "$skill" ]]; then
            echo "$stage"
            return 0
        fi
    done
    echo ""
}

# 列出所有未标 ✅ 的 stage (用于 stop-gate)
# Returns: 多行, 格式 "stage_name status"
list_unfinished_stages() {
    local md
    md=$(get_status_md)
    [[ -z "$md" || ! -f "$md" ]] && { echo ""; return 0; }
    awk -F'|' '
        /^\| *L/ {
            stage=$2; gsub(/^ +| +$/, "", stage)
            status=$3; gsub(/^ +| +$/, "", status)
            if (status !~ /✅/) print stage " | " status
        }
    ' "$md"
}
