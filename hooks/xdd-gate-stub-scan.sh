#!/bin/bash
# post-write-stub-scan.sh — Real-time stub detection on each Write/Edit.
# Triggered by: PostToolUse hook, matcher: "Write|Edit".
#
# Walker hard rule #1 (不写存根) is best caught as soon as a stub lands in
# a file, not at session end when 30 minutes of work has piled on top.
# This hook fires immediately after Write/Edit and surfaces stub patterns
# so the model can self-correct in the same turn.
#
# Behavior:
#   - Extract file_path from stdin JSON.
#   - Skip tiny files (< MIN_FILE_SIZE), excluded dirs, non-source files.
#   - Run scan_stub_in_file.
#   - Print findings as additional context. Always exit 0 (advisory only —
#     blocking Write would freeze scaffolding flows).
#
# Tunables (env vars):
#   SHADOW_MIN_FILE_SIZE — bytes, default 300 (skip empty / trivial files)
#   SHADOW_STUB_CAP      — max findings per file, default 10

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"
load_xdd_schema || echo "[xdd] ⚠️  .xdd/xdd-schema.json not found — stage auto-update disabled" >&2

MIN_SIZE="${SHADOW_MIN_FILE_SIZE:-300}"
CAP="${SHADOW_STUB_CAP:-10}"

# Parse file path from stdin JSON.
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Defensive defaults.
[[ -z "$file_path" ]] && exit 0
[[ ! -f "$file_path" ]] && exit 0

# Skip excluded paths (these are the dirs where stubs are *expected* / benign).
case "$file_path" in
    */.venv/*|*/node_modules/*|*/__pycache__/*|*/dist/*|*/build/*|*/target/*|*/.git/*) exit 0 ;;
    *) ;;
esac

# Skip tiny files (empty / trivial scaffolding).
size=$(stat -c%s "$file_path" 2>/dev/null || stat -f%z "$file_path" 2>/dev/null || echo 0)
if [[ "$size" -lt "$MIN_SIZE" ]]; then
    exit 0
fi

# Detect if this is a test file (more lenient — test files often have legitimate TODO).
is_test_file=0
case "$file_path" in
    *_test.*|*.test.*|*.spec.*|*/test/*|*/tests/*|*/__tests__/*) is_test_file=1 ;;
    *) ;;
esac

# Run the single-file scan.
findings=$(scan_stub_in_file "$file_path" "$CAP")

# === 实施 #19: 语义层 stub scan (放水 2 修) ===
# 4 个语义层 scan (unmounted_router / unconsumed_queue / dockerfile_drift / unregistered_error_code)
# 只在写源文件时跑 (handler / main / dockerfile / spec), advisory 不阻断
# 跑全项目, 不是只刚写的文件 — 这些是 project-wide invariant
# 用 file_path 推 project root (跟 hook cwd 解耦, 不会因 cwd 错配 miss)
proj_root=""
if [[ -n "$file_path" ]]; then
    # 从 file_path 一级一级往上找 backend/ 或 frontend/ 这种 src tree 标识
    _probe_dir="$(dirname "$file_path")"
    while [[ "$_probe_dir" != "/" ]]; do
        if [[ -d "$_probe_dir/backend" || -d "$_probe_dir/frontend" || -d "$_probe_dir/apps" ]]; then
            proj_root="$_probe_dir"
            break
        fi
        _probe_dir="$(dirname "$_probe_dir")"
    done
fi
[[ -z "$proj_root" ]] && proj_root="$(find_project_root 2>/dev/null)"
[[ -z "$proj_root" || "$proj_root" == "/" ]] && proj_root="."

case "$file_path" in
    */handler/*.go|*/cmd/*/main.go|*/Dockerfile*|*/bdd/*/spec.md|*/events/*.go)
        sem_findings=""
        # 1) unmounted router (Go chi) — 用 || true 防 set -e 退 (scan_* 返 1 找问题时)
        if [[ -d "$proj_root/backend/internal/handler" && -f "$proj_root/backend/cmd/api/main.go" ]]; then
            sem_r=$(scan_unmounted_routers "$proj_root/backend/internal/handler" "$proj_root/backend/cmd/api/main.go" 2>/dev/null) || true
            [[ -n "$sem_r" ]] && sem_findings="${sem_findings}${sem_r}\n"
        fi
        # 2) unconsumed queue
        if [[ -f "$proj_root/backend/internal/events/publisher.go" && -f "$proj_root/backend/cmd/worker/main.go" ]]; then
            sem_q=$(scan_unconsumed_queues "$proj_root/backend/internal/events/publisher.go" "$proj_root/backend/cmd/worker/main.go" 2>/dev/null) || true
            [[ -n "$sem_q" ]] && sem_findings="${sem_findings}${sem_q}\n"
        fi
        # 3) dockerfile drift
        if [[ -f "$proj_root/backend/Dockerfile" ]]; then
            sem_d=$(scan_dockerfile_drift "$proj_root/backend/Dockerfile" "$proj_root" 2>/dev/null) || true
            [[ -n "$sem_d" ]] && sem_findings="${sem_findings}${sem_d}\n"
        fi
        # 4) unregistered error code
        if [[ -d "$proj_root/backend/internal/handler" ]]; then
            xdd_d="$(get_xdd_dir 2>/dev/null)"
            if [[ -n "$xdd_d" ]]; then
                sem_e=$(scan_unregistered_error_codes "$proj_root/backend/internal/handler" "$xdd_d" 2>/dev/null) || true
                [[ -n "$sem_e" ]] && sem_findings="${sem_findings}${sem_e}\n"
            fi
        fi
        if [[ -n "$sem_findings" ]]; then
            echo ""
            echo "[xdd] 🐢 实施 #19 语义层 stub scan (放水 2 修, project root: $proj_root):"
            echo -e "$sem_findings" | sed 's/^/  /'
            echo ""
            echo "[xdd] 提示: 修这些语义层错 (跟字面 TODO/NotImplementedError 不同, 是真 stub)"
            echo "[xdd]   - unmounted-router: 在 main.go 加 r.Method(\"GET\", \"/path\", h.HandlerName)"
            echo "[xdd]   - unconsumed-queue: 在 worker/main.go 的 mux.HandleFunc(\"queue:type\", handler) 注册"
            echo "[xdd]   - dockerfile-drift: 检查 src 路径, 改 COPY 或补文件"
            echo "[xdd]   - unregistered-error-code: 在 .xdd/baseline/bdd/{slug}/spec.md 登记"
        fi
        ;;
esac

# === L4 增强: 写 stage 产物 → 自动标 DONE (在 stub 早退之前) ===
stage_id=$(match_stage_by_output "$file_path")
if [[ -n "$stage_id" ]]; then
    display_name="${stage_id/_/ }"
    md=$(get_status_md)
    if [[ -n "$md" && -f "$md" ]]; then
        cur_status=$(grep -E "^\| *$(echo "$display_name" | sed 's/[.[\*^$()+?{|]/\\&/g') " "$md" 2>/dev/null \
            | head -1 | awk -F'|' '{print $3}' | xargs)
        if [[ "$cur_status" == *"🔄"* || "$cur_status" == *"⏳"* ]]; then
            if update_stage_status "$display_name" "✅ DONE"; then
                echo "[xdd] → status.md 自动更新: $display_name  → ✅ DONE"
                echo "[xdd] (L4 增强: 写入了 stage 预期产物, 自动标完成)"
                # 找下一 stage 提示
                cur_num="${STAGE_NUM[$stage_id]:-}"
                for k in "${!STAGE_NUM[@]}"; do
                    n="${STAGE_NUM[$k]}"
                    if [[ $((n - cur_num)) -eq 1 ]]; then
                        next_skill="${STAGE_SKILL[$k]:-}"
                        echo "[xdd] → 下一 stage skill: $next_skill"
                        break
                    fi
                done
                echo ""
            fi
        fi
    fi
fi

# === P0-5/6 第一轮: R3 evidence_archive 写阻断(渐进保护) ===
# 文档说 "post-write 写入时触发 → chmod 444 阻断",但旧版只在 stop-gate 跑;
# 现在在 post-write 真实生效。第一轮: 仅警告 + 渐进 chmod (count >= 3 触发),
# 第二轮打磨: 加 .xdd/.r3_warn_count 持久文件 + 硬阻断 + init.sh 新文件例外.
# 触发场景: AI 写 wander-evidence/01.png / chaos-drill-evidence/ / issues.json
# 注意: 必须在 "无 stub 早退" 之前, 让 clean evidence 文件也走 R3 检查
root=$(find_project_root) || root=""
rel_path_probe="${file_path#$root/}"
role=$(lifecycle_role_of "$rel_path_probe")
if [[ "$role" == "evidence_archive" ]]; then
    echo ""
    echo "[xdd] 🐢 R3 evidence_archive 写入检测 (Phase 2-3 反证据改写护栏, 第一轮):"
    echo "[xdd]    角色: evidence_archive (wander-evidence / chaos-drill-evidence / issues.json)"
    echo "[xdd]    写入: $rel_path_probe"
    echo "[xdd]"
    echo "[xdd]    提醒: 证据存档默认只读 (R10 iter 冻结时 + chmod 444)."
    echo "[xdd]    第一次写入仅警告, 不阻断; 多次写入将由 gate-check 渐进 chmod."
    echo "[xdd]"
    echo "[xdd]    若你确认要保留这次写入 (例如 L6 漫游新加截图),"
    echo "[xdd]    请显式确认: '这个 evidence 写入是有意的' (让 Walker 不会反复警告)."
fi

if [[ -z "$findings" ]]; then
    # Clean. No output (don't bloat context on every Write).
    exit 0
fi

# Build warning. Try a project-relative path for readability (best effort).
root=$(find_project_root) || root=""
if [[ -n "$root" ]]; then
    rel_path="${file_path#$root/}"
else
    rel_path="$file_path"
fi

echo "[xdd] ⚠️  $rel_path 写入后含 Walker 硬规则 #1/2 禁止的存根模式："
echo "$findings" | sed 's/^/  /'
echo ""
if [[ "$is_test_file" == "1" ]]; then
    echo "[xdd] (这是测试文件 —— 测试中偶尔的 TODO/占位可能是合理的。"
    echo "[xdd]  如确认是误报，明示告知用户；如要严肃遵守硬规则，立即替换为真实实现。)"
else
    echo "[xdd] Walker 硬规则 #1: 不写存根；#2: 不用假实现。"
    echo "[xdd] 立即修复 —— 用真实实现替换占位代码。"
fi

# === P0-5/6 第一轮: R3 evidence_archive 写阻断(渐进保护) ===
# 文档说 "post-write 写入时触发 → chmod 444 阻断",但旧版只在 stop-gate 跑;
# 现在在 post-write 真实生效。第一轮: 仅警告 + 渐进 chmod (count >= 3 触发),
# 第二轮打磨: 加 .xdd/.r3_warn_count 持久文件 + 硬阻断 + init.sh 新文件例外.
# 触发场景: AI 写 wander-evidence/01.png / chaos-drill-evidence/ / issues.json
# 注意: 必须在 "无 stub 早退" 之前, 让 clean evidence 文件也走 R3 检查
role=$(lifecycle_role_of "${file_path#$root/}")
if [[ "$role" == "evidence_archive" ]]; then
    # 计算本路径所在 iter 下的 r3 计数 (临时用 mtime-based, 第二轮改成持久文件)
    # 第一轮简化: 每写一次就 warn, 不实际 chmod (留给 gate-check-lifecycle 触发时 chmod)
    echo ""
    echo "[xdd] 🐢 R3 evidence_archive 写入检测 (Phase 2-3 反证据改写护栏, 第一轮):"
    echo "[xdd]    角色: evidence_archive (wander-evidence / chaos-drill-evidence / issues.json)"
    echo "[xdd]    写入: $rel_path"
    echo "[xdd]"
    echo "[xdd]    提醒: 证据存档默认只读 (R10 iter 冻结时 + chmod 444)."
    echo "[xdd]    第一次写入仅警告, 不阻断; 多次写入将由 gate-check 渐进 chmod."
    echo "[xdd]"
    echo "[xdd]    若你确认要保留这次写入 (例如 L6 漫游新加截图),"
    echo "[xdd]    请显式确认: '这个 evidence 写入是有意的' (让 Walker 不会反复警告)."
fi

# Build warning. Try a project-relative path for readability (best effort).
root=$(find_project_root) || root=""
if [[ -n "$root" ]]; then
    rel_path="${file_path#$root/}"
else
    rel_path="$file_path"
fi

echo "[xdd] ⚠️  $rel_path 写入后含 Walker 硬规则 #1/2 禁止的存根模式："
echo "$findings" | sed 's/^/  /'
echo ""
if [[ "$is_test_file" == "1" ]]; then
    echo "[xdd] (这是测试文件 —— 测试中偶尔的 TODO/占位可能是合理的。"
    echo "[xdd]  如确认是误报，明示告知用户；如要严肃遵守硬规则，立即替换为真实实现)。)"
else
    echo "[xdd] Walker 硬规则 #1: 不写存根；#2: 不用假实现。"
    echo "[xdd] 立即修复 —— 用真实实现替换占位代码。"
fi

exit 0
