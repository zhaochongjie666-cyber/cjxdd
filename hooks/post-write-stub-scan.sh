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
load_shadow_schema || echo "[shadow] ⚠️  shadow-schema.json not found — stage auto-update disabled" >&2

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

exit 0
