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
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
load_shadow_schema || echo "[shadow] ⚠️  .shadow/shadow-schema.json not found — stage auto-update disabled" >&2

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
                echo "[shadow] → status.md 自动更新: $display_name  → ✅ DONE"
                echo "[shadow] (L4 增强: 写入了 stage 预期产物, 自动标完成)"
                # 找下一 stage 提示
                cur_num="${STAGE_NUM[$stage_id]:-}"
                for k in "${!STAGE_NUM[@]}"; do
                    n="${STAGE_NUM[$k]}"
                    if [[ $((n - cur_num)) -eq 1 ]]; then
                        next_skill="${STAGE_SKILL[$k]:-}"
                        echo "[shadow] → 下一 stage skill: $next_skill"
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
# 第二轮打磨: 加 .shadow/.r3_warn_count 持久文件 + 硬阻断 + init.sh 新文件例外.
# 触发场景: AI 写 wander-evidence/01.png / chaos-drill-evidence/ / issues.json
# 注意: 必须在 "无 stub 早退" 之前, 让 clean evidence 文件也走 R3 检查
root=$(find_project_root) || root=""
rel_path_probe="${file_path#$root/}"
role=$(lifecycle_role_of "$rel_path_probe")
if [[ "$role" == "evidence_archive" ]]; then
    echo ""
    echo "[shadow] 🐢 R3 evidence_archive 写入检测 (Phase 2-3 反证据改写护栏, 第一轮):"
    echo "[shadow]    角色: evidence_archive (wander-evidence / chaos-drill-evidence / issues.json)"
    echo "[shadow]    写入: $rel_path_probe"
    echo "[shadow]"
    echo "[shadow]    提醒: 证据存档默认只读 (R10 iter 冻结时 + chmod 444)."
    echo "[shadow]    第一次写入仅警告, 不阻断; 多次写入将由 gate-check 渐进 chmod."
    echo "[shadow]"
    echo "[shadow]    若你确认要保留这次写入 (例如 L6 漫游新加截图),"
    echo "[shadow]    请显式确认: '这个 evidence 写入是有意的' (让 Walker 不会反复警告)."
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

echo "[shadow] ⚠️  $rel_path 写入后含 Walker 硬规则 #1/2 禁止的存根模式："
echo "$findings" | sed 's/^/  /'
echo ""
if [[ "$is_test_file" == "1" ]]; then
    echo "[shadow] (这是测试文件 —— 测试中偶尔的 TODO/占位可能是合理的。"
    echo "[shadow]  如确认是误报，明示告知用户；如要严肃遵守硬规则，立即替换为真实实现。)"
else
    echo "[shadow] Walker 硬规则 #1: 不写存根；#2: 不用假实现。"
    echo "[shadow] 立即修复 —— 用真实实现替换占位代码。"
fi

# === P0-5/6 第一轮: R3 evidence_archive 写阻断(渐进保护) ===
# 文档说 "post-write 写入时触发 → chmod 444 阻断",但旧版只在 stop-gate 跑;
# 现在在 post-write 真实生效。第一轮: 仅警告 + 渐进 chmod (count >= 3 触发),
# 第二轮打磨: 加 .shadow/.r3_warn_count 持久文件 + 硬阻断 + init.sh 新文件例外.
# 触发场景: AI 写 wander-evidence/01.png / chaos-drill-evidence/ / issues.json
# 注意: 必须在 "无 stub 早退" 之前, 让 clean evidence 文件也走 R3 检查
role=$(lifecycle_role_of "${file_path#$root/}")
if [[ "$role" == "evidence_archive" ]]; then
    # 计算本路径所在 iter 下的 r3 计数 (临时用 mtime-based, 第二轮改成持久文件)
    # 第一轮简化: 每写一次就 warn, 不实际 chmod (留给 gate-check-lifecycle 触发时 chmod)
    echo ""
    echo "[shadow] 🐢 R3 evidence_archive 写入检测 (Phase 2-3 反证据改写护栏, 第一轮):"
    echo "[shadow]    角色: evidence_archive (wander-evidence / chaos-drill-evidence / issues.json)"
    echo "[shadow]    写入: $rel_path"
    echo "[shadow]"
    echo "[shadow]    提醒: 证据存档默认只读 (R10 iter 冻结时 + chmod 444)."
    echo "[shadow]    第一次写入仅警告, 不阻断; 多次写入将由 gate-check 渐进 chmod."
    echo "[shadow]"
    echo "[shadow]    若你确认要保留这次写入 (例如 L6 漫游新加截图),"
    echo "[shadow]    请显式确认: '这个 evidence 写入是有意的' (让 Walker 不会反复警告)."
fi

# Build warning. Try a project-relative path for readability (best effort).
root=$(find_project_root) || root=""
if [[ -n "$root" ]]; then
    rel_path="${file_path#$root/}"
else
    rel_path="$file_path"
fi

echo "[shadow] ⚠️  $rel_path 写入后含 Walker 硬规则 #1/2 禁止的存根模式："
echo "$findings" | sed 's/^/  /'
echo ""
if [[ "$is_test_file" == "1" ]]; then
    echo "[shadow] (这是测试文件 —— 测试中偶尔的 TODO/占位可能是合理的。"
    echo "[shadow]  如确认是误报，明示告知用户；如要严肃遵守硬规则，立即替换为真实实现)。)"
else
    echo "[shadow] Walker 硬规则 #1: 不写存根；#2: 不用假实现。"
    echo "[shadow] 立即修复 —— 用真实实现替换占位代码。"
fi

exit 0
