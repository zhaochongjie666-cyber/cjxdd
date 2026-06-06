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
# Patterns and excludes come from shadow-schema.json (single source of truth).
scan_stub_patterns() {
    local cap="${1:-20}"
    local dirs
    dirs=$(cat)

    [[ -z "$dirs" ]] && return 0
    load_shadow_schema || { echo ""; return 1; }

    local schema
    schema="${SHADOW_SCHEMA:-$(_resolve_schema_path)}"

    # Build grep -e args from JSON patterns (one -e per pattern).
    local -a grep_args=()
    while IFS= read -r p; do
        [[ -n "$p" ]] && grep_args+=(-e "$p")
    done < <(jq -r '.stub_patterns.patterns[]' "$schema")

    # Build --include args from JSON ext_globs.
    local -a include_args=()
    while IFS= read -r g; do
        [[ -n "$g" ]] && include_args+=(--include="$g")
    done < <(jq -r '.stub_patterns.ext_globs[]' "$schema")

    # Build grep -vE exclude regex from JSON excluded_dirs.
    local dirs_alt
    dirs_alt=$(jq -r '.stub_patterns.excluded_dirs | join("|")' "$schema")
    local exclude_re="/($dirs_alt)/"

    grep -rEn "${grep_args[@]}" "${include_args[@]}" $dirs 2>/dev/null \
        | grep -vE "$exclude_re" \
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
    [[ ! -r "$file" ]] && return 0
    local size
    size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
    [[ "$size" -gt 524288 ]] && return 0   # > 512KB, skip

    # Only scan recognized source extensions.
    case "$file" in
        *.py|*.ts|*.tsx|*.js|*.jsx|*.go|*.java|*.kt|*.rs) ;;
        *) return 0 ;;
    esac

    load_shadow_schema || { echo ""; return 1; }
    local schema
    schema="${SHADOW_SCHEMA:-$(_resolve_schema_path)}"

    local -a grep_args=()
    while IFS= read -r p; do
        [[ -n "$p" ]] && grep_args+=(-e "$p")
    done < <(jq -r '.stub_patterns.patterns[]' "$schema")

    grep -En "${grep_args[@]}" "$file" 2>/dev/null \
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

# ─────────── Stage 表 (从 shadow-schema.json 懒加载) ───────────
# 单一源真理: ../shadow-schema.json 的 .stages[] 段.
# 用 env var SHADOW_SCHEMA 覆盖路径 (主要用于测试).
# 所有函数在第一次被调用时 load_shadow_schema 一次, 之后纯数组查表.
declare -A STAGE_SKILL=()         # stage_id → skill_name
declare -A STAGE_NUM=()           # stage_id → num
declare -A STAGE_SKILL_NUM=()     # skill_name → num
declare -A STAGE_OUTPUTS=()       # stage_id → "pat1 pat2 ..." (空格分隔)
declare -A STAGE_ALIAS=()         # alias_string → stage_id
declare -A LIFECYCLE_ROLE=()      # artifact_id → role
declare -A LIFECYCLE_PATH=()      # artifact_id → canonical_path
declare -A LIFECYCLE_STAGE=()     # artifact_id → stage
_SCHEMA_LOADED=0
_SHADOW_SCHEMA_PATH=""

# 解析 schema 路径 (hooks 在仓库根 hooks/ 下, schema 在 ../shadow-schema.json).
# 关键: BASH_SOURCE 是调用时给的路径, 可能是软链. 用 readlink -f 解开找到仓库根.
_resolve_schema_path() {
    if [[ -n "${SHADOW_SCHEMA:-}" ]]; then
        echo "$SHADOW_SCHEMA"
    else
        local self_real
        self_real="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
        echo "$(dirname "$self_real")/../framework/shadow-schema.json"
    fi
}

# Load the schema. Idempotent. Returns 0 on success, 1 if schema not found.
load_shadow_schema() {
    [[ $_SCHEMA_LOADED -eq 1 ]] && return 0
    _SHADOW_SCHEMA_PATH=$(_resolve_schema_path)
    [[ -f "$_SHADOW_SCHEMA_PATH" ]] || return 1
    command -v jq >/dev/null 2>&1 || return 1

    # Populate stage arrays from .stages[]
    while IFS=$'\t' read -r id num skill outputs; do
        [[ -z "$id" ]] && continue
        STAGE_SKILL["$id"]="$skill"
        STAGE_NUM["$id"]="$num"
        STAGE_SKILL_NUM["$skill"]="$num"
        STAGE_OUTPUTS["$id"]="$outputs"
    done < <(jq -r '.stages[] | [.id, (.num|tostring), .skill, (.output_patterns | join(" "))] | @tsv' "$_SHADOW_SCHEMA_PATH")

    # Populate alias map from .stages[].aliases[]
    while IFS=$'\t' read -r alias id; do
        [[ -z "$alias" ]] && continue
        STAGE_ALIAS["$alias"]="$id"
    done < <(jq -r '.stages[] | (. as $s | ($s.aliases // [])[] | [., $s.id]) | @tsv' "$_SHADOW_SCHEMA_PATH")

    # Populate lifecycle_artifacts[] map (Phase 1)
    if jq -e '.lifecycle_artifacts.artifacts' "$_SHADOW_SCHEMA_PATH" >/dev/null 2>&1; then
        while IFS=$'\t' read -r id stage role path; do
            [[ -z "$id" ]] && continue
            LIFECYCLE_ROLE["$id"]="$role"
            LIFECYCLE_PATH["$id"]="$path"
            LIFECYCLE_STAGE["$id"]="$stage"
        done < <(jq -r '.lifecycle_artifacts.artifacts[]? | [.id, .stage, .role, .canonical_path] | @tsv' "$_SHADOW_SCHEMA_PATH")
    fi

    _SCHEMA_LOADED=1
    return 0
}

# alias 标准化: "L1 Research" / "L1_Research" / "l1 research" → "L1_Research"
# Args: $1 = display name from status.md
# Returns: internal ID (e.g. "L1_Research") or empty
stage_alias_to_id() {
    load_shadow_schema || { echo ""; return 0; }
    local name="$1"
    [[ -n "${STAGE_ALIAS[$name]:-}" ]] && echo "${STAGE_ALIAS[$name]}"
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
    load_shadow_schema || { echo ""; return 0; }
    # 转成相对路径
    local rel="${file_path#$root/}"
    [[ "$rel" == "$file_path" ]] && return 1  # 不在项目内

    # 遍历每个 stage 的 patterns, 用 bash case 通配
    for stage in "${!STAGE_OUTPUTS[@]}"; do
        local patterns="${STAGE_OUTPUTS[$stage]}"
        for pat in $patterns; do
            # 把 {slug} 替换成 *, * 保留
            local glob_pat="${pat//\{slug\}/*}"
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
    load_shadow_schema || { echo ""; return 0; }
    local skill="$1"
    for stage in "${!STAGE_SKILL[@]}"; do
        if [[ "${STAGE_SKILL[$stage]}" == "$skill" ]]; then
            echo "$stage"
            return 0
        fi
    done
    echo ""
}

# 把 skill 名转 stage num (0..11). Args: $1 = skill name. Returns num or empty.
skill_to_num() {
    load_shadow_schema || { echo ""; return 0; }
    local skill="$1"
    [[ -n "${STAGE_SKILL_NUM[$skill]:-}" ]] && echo "${STAGE_SKILL_NUM[$skill]}"
}

# Args: $1 = current stage id. Returns: next stage id (by num) or empty.
next_stage_id() {
    load_shadow_schema || { echo ""; return 0; }
    local cur="$1"
    local cur_num="${STAGE_NUM[$cur]:-}"
    [[ -z "$cur_num" ]] && { echo ""; return 0; }
    local target=$((cur_num + 1))
    for stage in "${!STAGE_NUM[@]}"; do
        if [[ "${STAGE_NUM[$stage]}" == "$target" ]]; then
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

# 统计当前 iter 下的 work order report 状态
# Returns: "done=N partial=N blocked=N failed=N total=N"
# 用于 session-start 摘要 + worker-dispatch-hint 累计统计.
count_wo_reports() {
    local shadow iter wo_dir
    shadow=$(get_shadow_dir) || { echo "total=0"; return 0; }
    [[ -z "$shadow" ]] && { echo "total=0"; return 0; }
    iter=$(get_current_iter)
    [[ -z "$iter" ]] && { echo "total=0"; return 0; }
    wo_dir="$shadow/iterations/$iter/work-orders"
    [[ ! -d "$wo_dir" ]] && { echo "total=0"; return 0; }

    local done=0 partial=0 blocked=0 failed=0
    local f
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        local head
        head=$(head -10 "$f" 2>/dev/null || true)
        case "$head" in
            *🟢*done*)    done=$((done+1)) ;;
            *🟡*partial*) partial=$((partial+1)) ;;
            *🔴*blocked*) blocked=$((blocked+1)) ;;
            *❌*failed*)  failed=$((failed+1)) ;;
        esac
    done < <(find "$wo_dir" -mindepth 2 -name "report.md" -type f 2>/dev/null)

    local total=$((done + partial + blocked + failed))
    echo "done=$done partial=$partial blocked=$blocked failed=$failed total=$total"
}

# ─────────── 工件生命周期 (lifecycle_artifacts) ───────────
# Phase 1 零破坏 — 仅查询不强制. 替代/补充旧的"跨迭代 vs 迭代作用域"位置二分法.
# 5 类: design_baseline / process_output / evidence_archive / control_marker / template_instance
# 详见 shadow-schema.json:lifecycle_artifacts.roles.

# 列出所有 (id|role|stage|canonical_path), 供 stop-gate 全量扫描.
# Returns: 多行, 格式 "id|role|stage|canonical_path"
list_lifecycle_artifacts() {
    load_shadow_schema || { echo ""; return 0; }
    local id
    for id in "${!LIFECYCLE_ROLE[@]}"; do
        printf "%s|%s|%s|%s\n" "$id" "${LIFECYCLE_ROLE[$id]}" "${LIFECYCLE_STAGE[$id]}" "${LIFECYCLE_PATH[$id]}"
    done
}

# 根据文件路径反查它的生命周期角色.
# Args: $1 = 绝对路径 (传相对路径也行)
# Returns: role 字符串 (design_baseline / process_output / evidence_archive / control_marker / template_instance / unknown)
# 算法: 把 canonical_path 和 aliases 里的 {iter}/{slug} 转成 *, 用 case glob 匹配
lifecycle_role_of() {
    load_shadow_schema || { echo "unknown"; return 0; }
    local file="$1"
    [[ -z "$file" ]] && { echo "unknown"; return 0; }

    # 转成项目内相对路径
    local root rel
    root=$(find_project_root) || { echo "unknown"; return 0; }
    rel="${file#$root/}"
    [[ "$rel" == "$file" ]] && rel="$file"   # 不在项目内,直接用原值

    local id path role
    for id in "${!LIFECYCLE_PATH[@]}"; do
        path="${LIFECYCLE_PATH[$id]}"
        # 主 canonical_path
        local glob_pat="${path//\{iter\}/*}"
        glob_pat="${glob_pat//\{slug\}/*}"
        glob_pat="${glob_pat//\{component\}/*}"
        glob_pat="${glob_pat//\{layer\}/*}"
        glob_pat="${glob_pat//\{type\}/*}"
        glob_pat="${glob_pat//\{ts\}/*}"
        # 末尾 / 表示目录匹配
        case "$glob_pat" in
            */) glob_pat="${glob_pat}*" ;;
        esac
        # shellcheck disable=SC2254
        case "$rel" in
            $glob_pat) echo "${LIFECYCLE_ROLE[$id]}"; return 0 ;;
        esac
        # aliases 也试一遍
        local aliases
        aliases=$(jq -r --arg id "$id" '.lifecycle_artifacts.artifacts[]? | select(.id == $id) | (.aliases // [])[]' "${SHADOW_SCHEMA:-$(_resolve_schema_path)}" 2>/dev/null)
        local alias
        for alias in $aliases; do
            local apat="${alias//\{iter\}/*}"
            apat="${apat//\{slug\}/*}"
            apat="${apat//\{component\}/*}"
            apat="${apat//\{layer\}/*}"
            apat="${apat//\{type\}/*}"
            apat="${apat//\{ts\}/*}"
            case "$apat" in
                */) apat="${apat}*" ;;
            esac
            # shellcheck disable=SC2254
            case "$rel" in
                $apat) echo "${LIFECYCLE_ROLE[$id]}"; return 0 ;;
            esac
        done
    done
    echo "unknown"
}

# 列指定角色下所有 canonical_path 模板, 供 stop-gate 扫某角色全量产物.
# Args: $1 = role
# Returns: 多行, 每行一个 canonical_path 模板
lifecycle_paths_by_role() {
    load_shadow_schema || { echo ""; return 0; }
    local role="$1"
    local id
    for id in "${!LIFECYCLE_ROLE[@]}"; do
        [[ "${LIFECYCLE_ROLE[$id]}" == "$role" ]] && echo "${LIFECYCLE_PATH[$id]}"
    done
}

# 统计 .shadow/ 下某角色实际存在的文件数 (session-start 角色分布用).
# Args: $1 = role
# Returns: 整数 (count)
count_lifecycle_role_files() {
    load_shadow_schema || { echo "0"; return 0; }
    local role="$1"
    local shadow root
    shadow=$(get_shadow_dir) || { echo "0"; return 0; }
    [[ -z "$shadow" ]] && { echo "0"; return 0; }
    root=$(find_project_root) || { echo "0"; return 0; }

    local count=0
    local id path
    for id in "${!LIFECYCLE_ROLE[@]}"; do
        [[ "${LIFECYCLE_ROLE[$id]}" != "$role" ]] && continue
        path="${LIFECYCLE_PATH[$id]}"
        # 模板路径(在 skills/ 下)不统计
        case "$path" in
            skills/*) continue ;;
        esac
        # 把 .shadow/ 前缀去掉, 因为 shadow 已是绝对
        local rel="${path#./}"
        rel="${rel#.shadow/}"
        # 简单 glob 化 + 通配符处理
        local abs_pat
        if [[ "$rel" == .shadow/* ]]; then
            abs_pat="$root/$rel"
        else
            abs_pat="$root/$rel"
        fi
        # 把 {iter}/{slug}/{component} 转成 *, 末尾 / 表示目录
        local gpat="${abs_pat//\{iter\}/*}"
        gpat="${gpat//\{slug\}/*}"
        gpat="${gpat//\{component\}/*}"
        # 用 find -path 匹配 (支持 /** 模式)
        if [[ "$gpat" == */\* ]]; then
            # 目录模式: 找该目录下任意文件
            local dir="${gpat%/\*}"
            [[ -d "$dir" ]] && {
                local n
                n=$(find "$dir" -mindepth 1 2>/dev/null | wc -l)
                count=$((count + n))
            }
        else
            # 文件模式: 直接 ls (glob 展开)
            # shellcheck disable=SC2086
            local files
            files=$(ls -1 $gpat 2>/dev/null | wc -l)
            count=$((count + files))
        fi
    done
    echo "$count"
}
