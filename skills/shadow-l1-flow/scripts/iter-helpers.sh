#!/usr/bin/env bash
# iter-helpers.sh — Shadow 迭代隔离辅助函数
# 提供迭代感知的路径解析，所有 gate 脚本和 check-prereq 脚本共用。
#
# 用法: source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
#
# 提供函数:
#   resolve_iter_root <project_dir>         — 返回当前迭代根目录
#   resolve_gate_dir <project_dir>          — 返回当前迭代的 gate 目录
#   resolve_pipeline_dir <project_dir>      — [预留给 pipeline 脚本] 返回迭代的 pipeline 目录
#   resolve_l6_deploy_dir <project_dir>     — [预留给 L6-deploy] 返回迭代的 L6-deploy 目录
#   migrate_legacy_shadow <project_dir>     — 迁移旧 .shadow/ 结构到 iter-1

# 读取当前迭代 ID，返回迭代根目录
# 如果 current-iteration 标记不存在（旧项目），触发迁移
resolve_iter_root() {
    local project_dir="$1"
    local shadow_dir="$project_dir/.shadow"
    local marker="$shadow_dir/current-iteration"

    if [ -f "$marker" ]; then
        local iter_id
        iter_id=$(tr -d '[:space:]' < "$marker")
        echo "$shadow_dir/iterations/$iter_id"
    else
        if [ -d "$shadow_dir" ]; then
            migrate_legacy_shadow "$project_dir"
            local iter_id
            iter_id=$(tr -d '[:space:]' < "$marker")
            echo "$shadow_dir/iterations/$iter_id"
        else
            echo "$shadow_dir"
        fi
    fi
}

# 返回当前迭代的 gate 目录
resolve_gate_dir() {
    local project_dir="$1"
    local iter_root
    iter_root="$(resolve_iter_root "$project_dir")"
    echo "$iter_root/gate"
}

# （resolve_feature_status_dir 已移除：feature-status 非迭代作用域，无调用者）
# （resolve_l5_plan_dir 已移除：L5-plan 是共享设计文档，路径为 .shadow/L5-plan/
#  不按迭代作用域隔离。由 L5 Plan / L5 Impl 直接引用 .shadow/L5-plan/。）

# 返回当前迭代的 pipeline 目录
resolve_pipeline_dir() {
    local project_dir="$1"
    local iter_root
    iter_root="$(resolve_iter_root "$project_dir")"
    echo "$iter_root/pipeline"
}

# 返回当前迭代的 L6-deploy 目录
resolve_l6_deploy_dir() {
    local project_dir="$1"
    local iter_root
    iter_root="$(resolve_iter_root "$project_dir")"
    echo "$iter_root/L6-deploy"
}

# 迁移旧 .shadow/ 结构到 iterations/iter-1/
# 旧路径 → 新路径:
#   .shadow/.gate/        → .shadow/iterations/iter-1/gate/
#   .shadow/.pipeline/    → .shadow/iterations/iter-1/pipeline/
#   .shadow/.feature-status/ → .shadow/iterations/iter-1/feature-status/
#   .shadow/L5-plan/      → .shadow/iterations/iter-1/L5-plan/
#   .shadow/L6-deploy/    → .shadow/iterations/iter-1/L6-deploy/
#   .shadow/reviews/      → .shadow/iterations/iter-1/reviews/
migrate_legacy_shadow() {
    local project_dir="$1"
    local shadow_dir="$project_dir/.shadow"
    local iter_dir="$shadow_dir/iterations/iter-1"

    if [ -f "$shadow_dir/current-iteration" ]; then
        return 0
    fi

    mkdir -p "$iter_dir"

    # 迁移迭代作用域目录（如果存在）
    local -a dirs=(".gate:pipeline" ".pipeline:pipeline" ".feature-status:feature-status" "L5-plan:L5-plan" "L6-deploy:L6-deploy" "reviews:reviews")
    local entry
    for entry in "${dirs[@]}"; do
        local old_name="${entry%%:*}"
        local new_name="${entry##*:}"
        if [ -d "$shadow_dir/$old_name" ]; then
            if [ "$old_name" = ".gate" ]; then
                mv "$shadow_dir/$old_name" "$iter_dir/gate"
            elif [ "$old_name" = ".pipeline" ]; then
                mv "$shadow_dir/$old_name" "$iter_dir/pipeline"
            else
                mv "$shadow_dir/$old_name" "$iter_dir/$new_name"
            fi
        fi
    done

    # 旧 gate 目录下的 .gate 也迁
    if [ -d "$shadow_dir/.gate" ]; then
        mkdir -p "$iter_dir/gate"
        mv "$shadow_dir/.gate"/* "$iter_dir/gate/" 2>/dev/null || true
        rmdir "$shadow_dir/.gate" 2>/dev/null || true
    fi

    echo "iter-1" > "$shadow_dir/current-iteration"
}

# --- gate-check-helpers 内联 ---
gate_init_checks() { :; }
gate_cleanup_checks() { :; }
gate_record_check() { :; }

# --- prereq-check-helpers 内联 ---
_PREREQ_PASS=0
_PREREQ_FAIL=0
_PREREQ_WARN=0
_PREREQ_SCRIPT=""

prereq_init() {
    local project_dir="$1" layer="$2" slug="$3"
    _PREREQ_PASS=0
    _PREREQ_FAIL=0
    _PREREQ_WARN=0
    _PREREQ_SCRIPT=""
}

prereq_ok() {
    local message="$1" check_id="${2:-}" evidence="${3:-}"
    echo "✅ $message"
    _PREREQ_PASS=$((_PREREQ_PASS + 1))
}

prereq_fail() {
    local message="$1" check_id="${2:-}" evidence="${3:-}"
    echo "❌ $message"
    _PREREQ_FAIL=$((_PREREQ_FAIL + 1))
}

prereq_warn() {
    local message="$1" check_id="${2:-}" evidence="${3:-}"
    echo "⚠️  $message"
    _PREREQ_WARN=$((_PREREQ_WARN + 1))
}

prereq_finish() {
    _PREREQ_SCRIPT="${1:-}"
    echo ""
    echo "=== 前置检查结果: PASS=$_PREREQ_PASS WARN=$_PREREQ_WARN FAIL=$_PREREQ_FAIL ==="
    if [ "$_PREREQ_FAIL" -gt 0 ]; then
        exit 1
    fi
}
