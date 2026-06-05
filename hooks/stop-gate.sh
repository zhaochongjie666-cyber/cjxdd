#!/bin/bash
# stop-gate.sh — Final gate check on session end.
# Triggered by: Stop hook.
#
# Walker hard rules being enforced:
#   #1 不写存根    — pass / TODO / NotImplementedError / InMemoryRepository
#   #2 不用假实现  — hardcoded current_user, mock DB
#   #3 说了完成就是真完成 — status.md 全部 ✅
#
# Behavior:
#   - Scan source dirs for stub patterns; print findings.
#   - Check status.md for ⏳ or 🔄 stages; print pending list.
#   - Always exit 0 (advisory). Walker's own discipline treats the reminders
#     as a hard stop; the hook is here so the model is *shown* the evidence
#     before declaring DONE.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
load_shadow_schema || true  # drift check will skip stage matching, but stub scan still works

shadow=$(get_shadow_dir)
if [[ -z "$shadow" ]]; then
    # Not a shadow project. No-op.
    exit 0
fi

iter=$(get_current_iter)
echo "[shadow] === Stop Gate (iter=$iter) ==="

# --- Check 1: stub patterns in source code ---
source_dirs=$(find_source_dirs)
if [[ -n "$source_dirs" ]]; then
    stubs=$(echo "$source_dirs" | scan_stub_patterns 25)
    if [[ -n "$stubs" ]]; then
        echo ""
        echo "[shadow] ⚠️  Stub / fake-impl pattern scan (Walker rule #1, #2):"
        echo "$stubs" | sed 's/^/  /'
        echo ""
        echo "[shadow] Hard rule: 不写存根 / 不用假实现. If these are real, fix them"
        echo "[shadow] before declaring DONE. If they are docstrings / false positives,"
        echo "[shadow] acknowledge explicitly to the user."
    else
        echo "[shadow] ✓ Stub pattern scan: clean"
    fi
else
    echo "[shadow] (no source dirs found; skipping stub scan)"
fi

# --- Check 2: pipeline status completeness (per-bizline) ---
md=$(get_status_md)
if [[ -n "$md" && -f "$md" ]]; then
    # Try per-bizline breakdown first (multi-bizline projects).
    pending_bxx=$(read_pending_stages)
    if [[ -n "$pending_bxx" ]]; then
        echo ""
        echo "[shadow] ⚠️  Pipeline not complete. Pending/in-progress stages (per-bizline):"
        echo "$pending_bxx"
        echo ""
        echo "[shadow] Walker hard rule: 说了完成就是真完成. 用户要看到全链路"
        echo "[shadow] 跑通 + 数据落地 + 页面可开 + 权限正确 之后才算完。"
    else
        # No ## BXX sections — check flat (single-bizline) or all ✅.
        flat_pending=$(awk -F'|' '
            /^\|\s*L/ {
                stage=$2; gsub(/^ +| +$/, "", stage)
                status=$3; gsub(/^ +| +$/, "", status)
                if (status ~ /⏳/ || status ~ /🔄/) print stage
            }
        ' "$md")

        if [[ -n "$flat_pending" ]]; then
            echo ""
            echo "[shadow] ⚠️  Pipeline not complete. Pending/in-progress stages:"
            echo "$flat_pending" | sed 's/^/  - /'
            echo ""
            echo "[shadow] (Single-bizline view — for multi-bizline projects, organize"
            echo "[shadow]  status.md with '## BXX 业务线名' sections per Walker format.)"
        else
            # All ✅ — confirm but also remind about L6 verification.
            echo ""
            echo "[shadow] ✓ Pipeline stages all complete in status.md."
            if ! grep -q "L6.*✅" "$md" 2>/dev/null; then
                echo "[shadow] ⚠️  L6 not marked ✅. Walker rule: 不主动写 DONE — L6 漫游"
                echo "[shadow] 修复 3 轮硬上限内必须跑过才算交付。"
            fi
        fi
    fi

    # === L5 增强: stage 漂移检查 ===
    # 扫所有 stage 的预期产物, 检查:
    #   1) 产物已写但 status.md 未标 ✅ (drift)
    #   2) 当前 stage 标 DOING 但产物还没出现
    echo ""
    echo "[shadow] === L5 Stage Drift Check (L5 增强) ==="
    root=$(find_project_root)
    drift_found=0
    missing_found=0
    for stage_id in "${!STAGE_OUTPUTS[@]}"; do
        patterns="${STAGE_OUTPUTS[$stage_id]}"
        display_name="${stage_id/_/ }"
        # 当前 status
        cur_status=$(grep -E "^\| *$(echo "$display_name" | sed 's/[.[\*^$()+?{|]/\\&/g') " "$md" 2>/dev/null \
            | head -1 | awk -F'|' '{print $3}' | xargs)
        # 检查产物存在 — 取每个 pattern 的目录部分, 看是否有文件
        product_exists=0
        for pat in $patterns; do
            # 把 pattern 转成目录: 去掉最后一段 (文件名) 和 * 通配
            # ".shadow/L0-research/*.md" → ".shadow/L0-research"
            # ".shadow/L1-business/{slug}/intent.md" → ".shadow/L1-business" (粗粒度, 也够用)
            # "Dockerfile" → "." (项目根)
            check_dir=$(echo "$pat" | sed -E 's|/[^/]*\*?[^/]*$||' | sed 's|{slug}||g')
            [[ -z "$check_dir" ]] && check_dir="."
            if [[ -n "$root" && -d "$root/$check_dir" ]] && [[ -n "$(ls -A "$root/$check_dir" 2>/dev/null)" ]]; then
                product_exists=1
                break
            fi
        done
        # 漂移: 产物已写但 status.md 还标 ⏳/🔄
        if [[ $product_exists -eq 1 && ( "$cur_status" == *"⏳"* || "$cur_status" == *"🔄"* ) ]]; then
            echo "[shadow]   DRIFT: $display_name 产物已存在, 但 status.md 标 '$cur_status' (应自动标 ✅)"
            drift_found=1
        fi
        # 当前 stage (DOING) 但产物还没出现
        if [[ "$cur_status" == *"🔄"* && $product_exists -eq 0 ]]; then
            echo "[shadow]   PENDING: $display_name 标 DOING 但预期产物尚未出现"
            missing_found=1
        fi
    done
    if [[ $drift_found -eq 0 && $missing_found -eq 0 ]]; then
        echo "[shadow]   ✓ 无漂移, status.md 与产物状态一致"
    fi
else
    echo ""
    echo "[shadow] (no status.md; walker not started or status file missing)"
fi

echo ""
echo "[shadow] === End Stop Gate ==="
exit 0
