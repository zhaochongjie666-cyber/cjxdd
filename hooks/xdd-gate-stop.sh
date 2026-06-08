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
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"
load_xdd_schema || true  # drift check will skip stage matching, but stub scan still works

# P0-4: 动态算 lifecycle_artifacts 工件数 (避免硬编码 58 漂移)
artifacts_count=$(jq -r '.lifecycle_artifacts.artifacts | length' "${SHADOW_SCHEMA:-$(_resolve_xdd_schema_path)}" 2>/dev/null || echo "59")

xdd_dir=$(get_xdd_dir)
if [[ -z "$xdd_dir" ]]; then
    # Not a xdd project. No-op.
    exit 0
fi

iter=$(get_current_iter)
echo "[xdd] === Stop Gate (iter=$iter) ==="

# --- Check 1: stub patterns in source code ---
source_dirs=$(find_source_dirs)
if [[ -n "$source_dirs" ]]; then
    stubs=$(echo "$source_dirs" | scan_stub_patterns 25)
    if [[ -n "$stubs" ]]; then
        echo ""
        echo "[xdd] ⚠️  Stub / fake-impl pattern scan (Walker rule #1, #2):"
        echo "$stubs" | sed 's/^/  /'
        echo ""
        echo "[xdd] Hard rule: 不写存根 / 不用假实现. If these are real, fix them"
        echo "[xdd] before declaring DONE. If they are docstrings / false positives,"
        echo "[xdd] acknowledge explicitly to the user."
    else
        echo "[xdd] ✓ Stub pattern scan: clean"
    fi
else
    echo "[xdd] (no source dirs found; skipping stub scan)"
fi

# --- Check 2: pipeline status completeness (per-bizline) ---
md=$(get_status_md)
if [[ -n "$md" && -f "$md" ]]; then
    # Try per-bizline breakdown first (multi-bizline projects).
    pending_bxx=$(read_pending_stages)
    if [[ -n "$pending_bxx" ]]; then
        echo ""
        echo "[xdd] ⚠️  Pipeline not complete. Pending/in-progress stages (per-bizline):"
        echo "$pending_bxx"
        echo ""
        echo "[xdd] Walker hard rule: 说了完成就是真完成. 用户要看到全链路"
        echo "[xdd] 跑通 + 数据落地 + 页面可开 + 权限正确 之后才算完。"
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
            echo "[xdd] ⚠️  Pipeline not complete. Pending/in-progress stages:"
            echo "$flat_pending" | sed 's/^/  - /'
            echo ""
            echo "[xdd] (Single-bizline view — for multi-bizline projects, organize"
            echo "[xdd]  status.md with '## BXX 业务线名' sections per Walker format.)"
        else
            # All ✅ — confirm but also remind about L6 verification.
            echo ""
            echo "[xdd] ✓ Pipeline stages all complete in status.md."
            if ! grep -q "L6.*✅" "$md" 2>/dev/null; then
                echo "[xdd] ⚠️  L6 not marked ✅. Walker rule: 不主动写 DONE — L6 漫游"
                echo "[xdd] 修复 3 轮硬上限内必须跑过才算交付。"
            fi
        fi
    fi

    # === L5 增强: stage 漂移检查 ===
    # 扫所有 stage 的预期产物, 检查:
    #   1) 产物已写但 status.md 未标 ✅ (drift)
    #   2) 当前 stage 标 DOING 但产物还没出现
    echo ""
    echo "[xdd] === L5 Stage Drift Check (L5 增强) ==="
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
            # ".xdd/L0-research/*.md" → ".xdd/L0-research"
            # ".xdd/L1-business/{slug}/intent.md" → ".xdd/L1-business" (粗粒度, 也够用)
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
            echo "[xdd]   DRIFT: $display_name 产物已存在, 但 status.md 标 '$cur_status' (应自动标 ✅)"
            drift_found=1
        fi
        # 当前 stage (DOING) 但产物还没出现
        if [[ "$cur_status" == *"🔄"* && $product_exists -eq 0 ]]; then
            echo "[xdd]   PENDING: $display_name 标 DOING 但预期产物尚未出现"
            missing_found=1
        fi
    done
    if [[ $drift_found -eq 0 && $missing_found -eq 0 ]]; then
        echo "[xdd]   ✓ 无漂移, status.md 与产物状态一致"
    fi
else
    echo ""
    echo "[xdd] (no status.md; walker not started or status file missing)"
fi

echo ""
echo "[xdd] === End Stop Gate ==="

# --- Check 3: artifact lifecycle drift (Phase 2 升级) ---
# 5 条软警告 + 1 条 R5 硬阻断 — 漂移 ≥ 1 时 exit 1.
# 详见 .xdd/xdd-schema.json:lifecycle_artifacts[] + CLAUDE.md § 7 + skills/xdd-artifact-lifecycle/.
echo ""
echo "[xdd] === Lifecycle Drift (Phase 2: 软警告 + R5 硬门禁) ==="
lifecycle_drift=0

# 3.1 .skel 文件遗留 (L3-skeleton DEPRECATED, 被 harness-plan 替代)
skel_files=$(find "$xdd_dir" -name "*.skel" 2>/dev/null | head -10)
if [[ -n "$skel_files" ]]; then
    echo "[xdd]   ⚠️  .skel files found (L3-skeleton 已废, 由 harness-plan 替代):"
    echo "$skel_files" | sed 's/^/      /'
    echo "[xdd]     → 归档到 .xdd/legacy/ (Phase 3 处理)"
    lifecycle_drift=1
fi

# 3.2 老 L3 文件名 (单→复, plan→matrix, failsafe→policies)
if [[ -d "$xdd_dir/L3-resilience" ]]; then
    old_l3=$(find "$xdd_dir/L3-resilience" -type f \( \
        -name "policies.md" -o \
        -name "chaos-experiments.md" -o \
        -name "resilience-test-matrix.md" \
    \) 2>/dev/null | head -10)
    if [[ -n "$old_l3" ]]; then
        echo "[xdd]   ⚠️  Old L3 aliases (canonical = failsafe-design / chaos-scenarios / resilience-test-plan):"
        echo "$old_l3" | sed 's/^/      /'
        lifecycle_drift=1
    fi
fi

# 3.3 deployment-report.md vs deploy-report.md
if [[ -f "$xdd_dir/L6-deploy/deploy-report.md" ]]; then
    echo "[xdd]   ⚠️  Found .xdd/L6-deploy/deploy-report.md (alias). Canonical = deployment-report.md"
    lifecycle_drift=1
fi
# 老的 schema reviewer 路径
if [[ -d "$xdd_dir/reviewer" ]]; then
    echo "[xdd]   ⚠️  Found .xdd/reviewer/ (schema-老路径). Canonical = .xdd/iterations/{iter}/reviews/"
    lifecycle_drift=1
fi

# 3.4 feature-status 位置漂移 (3 派位置, 统一认迭代作用域)
if [[ -d "$xdd_dir/feature-status" ]]; then
    echo "[xdd]   ⚠️  Found .xdd/feature-status/ (top-level). Canonical = .xdd/iterations/{iter}/feature-status/{slug}/"
    lifecycle_drift=1
fi
if [[ -d "$xdd_dir/L5-plan" ]]; then
    fs_in_l5=$(find "$xdd_dir/L5-plan" -type d -name "feature-status" 2>/dev/null | head -3)
    if [[ -n "$fs_in_l5" ]]; then
        echo "[xdd]   ⚠️  Found L5-plan/{slug}/feature-status/. Canonical = .xdd/iterations/{iter}/feature-status/{slug}/"
        echo "$fs_in_l5" | sed 's/^/      /'
        lifecycle_drift=1
    fi
fi

# 3.5 L1 wire 老 schema 路径
if [[ -d "$xdd_dir/L1-business/wireframes" ]]; then
    echo "[xdd]   ⚠️  Found .xdd/L1-business/wireframes/. Canonical = .xdd/L1-business/wire.svg (项目级单张)"
    lifecycle_drift=1
fi

if [[ $lifecycle_drift -eq 0 ]]; then
    echo "[xdd]   ✓ 无 lifecycle 漂移 (5 类角色, ${artifacts_count} 工件全部就位)"
else
    echo ""
    echo "[xdd]   发现 $lifecycle_drift 处 Phase 1 漂移 (软警告: 仅提示, 不阻断)"
    echo "[xdd]   详细角色定义见: .xdd/xdd-schema.json:lifecycle_artifacts.roles + CLAUDE.md § 7"
    echo "[xdd]   处置指引见: skills/xdd-artifact-lifecycle/references/drift-examples.md"
fi

# --- R5 硬门禁: 调 xdd-artifact-lifecycle/scripts/gate-check-lifecycle.sh ---
# Phase 2: R5 漂移扫描升级为硬门禁 (识别率 < 80% 时 exit 1)
# ⚠️  ADVISORY ONLY: stop-gate 必须永远 exit 0 (跟本文件头部注释一致),
#     跟 file header "Always exit 0 (advisory)" 保持一致. R5 fail 信息通过 stdout
#     展示给用户/模型, 不阻断 stop hook (否则 Claude Code 会报
#     "Stop hook error: non-blocking status code: No stderr output").
#     真正决定硬阻断的是 gate-check-lifecycle.sh 自身的 exit code (0/1/2/3),
#     而 stop-gate 只做传递 + 展示.
echo ""
echo "[xdd] === R5 硬门禁 (调用 gate-check-lifecycle.sh) ==="
gate_script="$SCRIPT_DIR/../skills/xdd-artifact-lifecycle/scripts/gate-check-lifecycle.sh"
if [[ -f "$gate_script" ]]; then
    # 跑 gate-check, 但吞掉 R1/R3/R6/R10 (advisory), 只看 exit code
    if bash "$gate_script" > /tmp/lifecycle-gate-$$.log 2>&1; then
        echo "[xdd]   ✓ R5: 5 角色一致性 + ${artifacts_count} 工件识别率 ≥ 80%, 通过"
    else
        echo "[xdd]   ❌ R5 硬门禁触发 (识别率 < 80% 或 evidence_archive 写违反) — ADVISORY"
        echo ""
        echo "[xdd]   gate-check-lifecycle.sh 输出:"
        cat /tmp/lifecycle-gate-$$.log | sed 's/^/      /' | tail -30
        rm -f /tmp/lifecycle-gate-$$.log
        echo ""
        echo "[xdd]   R5 硬门禁 fail — 请修复后重试 (advisory, 不阻断 stop)"
        echo "[xdd]   处置指引见: skills/xdd-artifact-lifecycle/SKILL.md"
    fi
    rm -f /tmp/lifecycle-gate-$$.log
else
    echo "[xdd]   ⚠️  gate-check-lifecycle.sh 未找到 (skills/xdd-artifact-lifecycle/ 不存在?), 跳过 R5"
fi

exit 0
