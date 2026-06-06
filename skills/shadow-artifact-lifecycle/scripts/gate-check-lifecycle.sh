#!/bin/bash
# gate-check-lifecycle.sh — 5 角色 × canonical_path 一致性检查
#
# 触发: 手工跑 (shadow-artifact-lifecycle 装上后,或 stop-gate 末尾)
# 用法: bash skills/shadow-artifact-lifecycle/scripts/gate-check-lifecycle.sh
#
# 5 条硬门禁 (Phase 2):
#   R1 — 设计基线改动传播 (mtime 异常检测)
#   R3 — 证据写阻断 (evidence_archive chmod 444 + 检测被改写)
#   R5 — 漂移扫描 (5 类漂移, ≥ 1 时 exit 1)
#   R6 — 路径 locality (Write/Edit 落到 .shadow/ 但不在 canonical_path 列表)
#   R10 — 自动 .archived 锁 (iter 冻结时 evidence_archive 加 .archived 后缀)
#
# 退出码:
#   0 — 无漂移 / 全部通过
#   1 — 漂移 ≥ 1 (R5 硬阻断)
#   2 — 调用错误
#   3 — schema 缺失 (致命)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$SKILL_DIR")")"
PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"

# ───────── 加载 hooks/lib.sh (需要 _resolve_schema_path + lifecycle_role_of) ─────────
HOOKS_DIR="$REPO_ROOT/hooks"
if [[ -f "$HOOKS_DIR/lib.sh" ]]; then
    # shellcheck source=../../../hooks/lib.sh
    source "$HOOKS_DIR/lib.sh"
else
    echo "[lifecycle-gate] FATAL: hooks/lib.sh not found at $HOOKS_DIR" >&2
    exit 3
fi

# 现在 _resolve_schema_path 已加载, 用它查 schema (Phase 2-3 优先级: .shadow/ > framework/ > framework template)
SCHEMA="${SHADOW_SCHEMA:-$(_resolve_schema_path)}"

if [[ ! -f "$SCHEMA" ]]; then
    echo "[lifecycle-gate] FATAL: shadow-schema.json not found at $SCHEMA" >&2
    exit 3
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "[lifecycle-gate] FATAL: jq not installed" >&2
    exit 3
fi

# ───────── 解析 schema + 加载 LIFECYCLE_* 数组 ─────────
load_shadow_schema || { echo "[lifecycle-gate] FATAL: load_shadow_schema failed" >&2; exit 3; }

echo "[lifecycle-gate] === 5 类角色 × 58 工件一致性检查 ==="
echo ""

# ───────── Check 0: 自身完整性 (roles + artifacts 数量) ─────────
roles_count=$(jq -r '.lifecycle_artifacts.roles | length' "$SCHEMA")
artifacts_count=$(jq -r '.lifecycle_artifacts.artifacts | length' "$SCHEMA")
echo "[lifecycle-gate]   schema: $roles_count 角色, $artifacts_count 工件"
if [[ "$roles_count" -ne 5 ]]; then
    echo "[lifecycle-gate]   ❌ R5: 期望 5 角色, 实际 $roles_count"
    exit 1
fi
if [[ "$artifacts_count" -lt 50 ]]; then
    echo "[lifecycle-gate]   ❌ R5: 工件数量 < 50, 期望 58 ± 5"
    exit 1
fi

# ───────── Check 1: 5 角色分布 (按 schema) ─────────
echo ""
echo "[lifecycle-gate] --- 5 角色分布 (schema 登记) ---"
for role in design_baseline process_output evidence_archive control_marker template_instance; do
    n=$(jq -r --arg r "$role" '.lifecycle_artifacts.artifacts[] | select(.role == $r) | .id' "$SCHEMA" | wc -l)
    printf "  %-20s : %d 工件\n" "$role" "$n"
done

# ───────── Check 2: 实际 .shadow/ 实物 vs schema 识别率 ─────────
shadow_dir="$PROJECT_ROOT/.shadow"
pct=100  # 默认 100% (无 .shadow/ 时跳过 R5)
r5_status="skip"
unknown_files=()
if [[ -d "$shadow_dir" ]]; then
    echo ""
    echo "[lifecycle-gate] --- 实物识别率 (实际文件 vs lifecycle_role_of) ---"
    total=0
    identified=0
    unknown=0
    weighted_id=0  # P0-8: 加权识别率 (设计基线/证据权重 3, 其他 1)
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        rel="${f#$PROJECT_ROOT/}"
        role=$(lifecycle_role_of "$rel")
        total=$((total+1))
        if [[ "$role" == "unknown" ]]; then
            unknown=$((unknown+1))
            unknown_files+=("$rel")
        else
            identified=$((identified+1))
            # P0-8: 加权 (design_baseline/evidence_archive 错 1 个比 control_marker 错 1 个严重)
            case "$role" in
                design_baseline|evidence_archive) weighted_id=$((weighted_id + 3)) ;;
                process_output|control_marker) weighted_id=$((weighted_id + 1)) ;;
                template_instance) weighted_id=$((weighted_id + 0)) ;;  # 模板不计入 (留 reserved)
                *) weighted_id=$((weighted_id + 1)) ;;
            esac
        fi
    done < <(find "$shadow_dir" -type f -not -path "*/node_modules/*" -not -path "*/templates/*" 2>/dev/null)

    if [[ $total -eq 0 ]]; then
        echo "  (空 .shadow/, 跳过 R5)"
    else
        pct=$((identified * 100 / total))
        # P0-8: 加权识别率 (设计基线/证据存档权重 3, 其他 1)
        # 简化: weighted_total = total * 3 (假设所有都按 design_baseline 算)
        # 实际按角色 sum 的 weighted_id / weighted_total
        weighted_total=$((total * 3))
        weighted_pct=$((weighted_id * 100 / weighted_total))
        # P0-8: 分档阈值 (老项目 ≥ 90% pass / 75-90% warn / < 75% fail)
        # 老项目阈值放宽 10%
        if [[ -f "$shadow_dir/LIFECYCLE.md" ]]; then
            pass_thresh=90
            warn_thresh=75
        else
            pass_thresh=80
            warn_thresh=65
        fi
        echo "  实物: $total, 识别: $identified, unknown: $unknown (简单 $pct% / 加权 ${weighted_pct}%)"
        if [[ $weighted_pct -lt $warn_thresh ]]; then
            # R5 硬门禁: 只在 .shadow/LIFECYCLE.md 存在(新项目标记)时触发
            if [[ -f "$shadow_dir/LIFECYCLE.md" ]]; then
                echo "  ❌ R5: 加权识别率 ${weighted_pct}% < ${warn_thresh}% (新项目, 硬门禁)"
                printf '  unknown files:\n'
                for f in "${unknown_files[@]}"; do
                    printf '    %s\n' "$f"
                done | head -20
                r5_status="fail"
            else
                echo "  ⚠️  R5: 加权识别率 ${weighted_pct}% < ${warn_thresh}% (老项目, 降级 advisory)"
                echo "      建议: 创建 .shadow/LIFECYCLE.md 启用硬门禁;或跑 shadow-init 重生 .shadow/"
                echo "      处置指引: skills/shadow-artifact-lifecycle/references/drift-examples.md"
                r5_status="advisory"
            fi
        else
            echo "  ✓ R5: 加权识别率 ${weighted_pct}% ≥ ${pass_thresh}% (pass)"
            r5_status="pass"
        fi
    fi
else
    echo ""
    echo "[lifecycle-gate] (no .shadow/, 跳过实物扫描 + R5)"
fi

# ───────── R3: 证据写阻断 (evidence_archive chmod 444, P0-6 第二轮渐进保护) ─────────
echo ""
echo "[lifecycle-gate] --- R3: evidence_archive 写阻断 (渐进保护) ---"
violations=0
fixed=0
# 渐进计数器: 0/1/2 = 警告+chmod, ≥3 = exit 1 (P0-6 第二轮, 按用户指导多轮打磨)
R3_COUNTER_FILE="$shadow_dir/.r3_warn_count"
r3_count=$(cat "$R3_COUNTER_FILE" 2>/dev/null || echo 0)
# 直接遍历 .shadow/ 实际存在的 evidence_archive 目录/文件,不依赖 path 占位符
if [[ -d "$shadow_dir" ]]; then
    # wander-evidence/ 和 chaos-drill-evidence/ 目录
    while IFS= read -r evidence_dir; do
        [[ -z "$evidence_dir" ]] && continue
        bad=$(find "$evidence_dir" -type f -not -name "*.archived" -perm -u+w 2>/dev/null)
        if [[ -n "$bad" ]]; then
            n=$(echo "$bad" | wc -l)
            echo "  ⚠️  R3 违反: $evidence_dir 下 $n 个文件可写 (累计: $((r3_count + n))/$((r3_count + n + 1))/?)"
            echo "$bad" | sed 's/^/      /' | head -3
            while IFS= read -r f; do
                [[ -z "$f" ]] && continue
                chmod 444 "$f" 2>/dev/null && fixed=$((fixed+1))
            done <<< "$bad"
            violations=$((violations + n))
        fi
    done < <(find "$shadow_dir" -type d \( -name "wander-evidence" -o -name "chaos-drill-evidence" \) 2>/dev/null)

    # issues.json 文件
    while IFS= read -r issues_file; do
        [[ -z "$issues_file" ]] && continue
        if [[ -w "$issues_file" ]]; then
            echo "  ⚠️  R3 违反: $issues_file 可写"
            chmod 444 "$issues_file" 2>/dev/null && fixed=$((fixed+1))
            violations=$((violations+1))
        fi
    done < <(find "$shadow_dir" -type f -name "issues.json" -not -name "*.archived" 2>/dev/null)
fi
# 写累计计数 (P0-6 第二轮: 持久 .r3_warn_count 文件, 让多轮 gate-check 累加)
if [[ $violations -gt 0 ]]; then
    r3_count=$((r3_count + violations))
    echo "$r3_count" > "$R3_COUNTER_FILE"
    echo "  ⚠️  R3: 累计可写 evidence_archive = $r3_count 次 (计数器已持久到 .r3_warn_count)"
    if [[ $r3_count -ge 3 ]]; then
        echo "  ❌ R3 硬门禁: 累计 $r3_count 次 ≥ 3, 触发 exit 1"
        echo "  处置: 1) 确认是 iter 冻结用 R10 (`init.sh --archive-old`) / 2) 否则 chmod 644 后人工 review 证据"
    fi
else
    # 无违反, 重置计数器
    [[ -f "$R3_COUNTER_FILE" ]] && rm -f "$R3_COUNTER_FILE"
    echo "  ✓ R3: 全部 evidence_archive 文件只读 (chmod 444 或不存在)"
fi
# 硬门禁: 累计 ≥ 3 → exit 1 (计入最后 violations 决定)
R3_HARD_BLOCK=0
[[ -f "$R3_COUNTER_FILE" ]] && [[ $(cat "$R3_COUNTER_FILE") -ge 3 ]] && R3_HARD_BLOCK=1

# ───────── R10: 自动 .archived 锁 ─────────
# ───────── R1: 设计基线改动传播 (P0-7 第二轮: 24h >= 3 次 + 配对下游 stage) ─────────
echo ""
echo "[lifecycle-gate] --- R1: design_baseline 24h 内 ≥ 3 次修改 (P0-7 阈值) ---"
r1_warn=0
for id in "${!LIFECYCLE_ROLE[@]}"; do
    role="${LIFECYCLE_ROLE[$id]}"
    [[ "$role" != "design_baseline" ]] && continue
    path="${LIFECYCLE_PATH[$id]}"
    case "$path" in
        skills/*) continue ;;
        backend/*|frontend/*|tests/*|e2e/*|migrations/*) continue ;;  # 项目代码不在 .shadow/
    esac
    gpath=$(echo "$path" | sed -E 's/\{iter\}//g; s/\{slug\}//g; s/\{component\}//g; s/\*.*$//')
    real_gpath="$PROJECT_ROOT/${gpath#.shadow/}"
    if [[ -e "$real_gpath" ]]; then
        # P0-7: 24h 内修改次数 (单次改是常态, >= 3 次才真信号)
        recent_count=$(find "$real_gpath" -type f -mtime -1 2>/dev/null | wc -l)
        if [[ $recent_count -ge 3 ]]; then
            # 配对下游 stage (P0-7 简化映射, 后续可放 schema downstream_stages 字段)
            case "$id" in
                spec-bxx) downstream="L1.5 架构 / L2 e2e" ;;
                research-bxx) downstream="L1.5 架构" ;;
                architecture-bxx) downstream="L2 e2e / L5 plan" ;;
                harness-plan) downstream="L5 impl" ;;
                *) downstream="相关下游" ;;
            esac
            echo "  ⚠️  R1: $id 24h 内 $recent_count 次修改 (≥ 3 真信号)"
            echo "      配对下游 stage: $downstream"
            echo "      建议显式确认: '$id 的修改是否需要重跑 $downstream?'"
            r1_warn=$((r1_warn+1))
        fi
    fi
done
if [[ $r1_warn -eq 0 ]]; then
    echo "  ✓ R1: 24h 内 design_baseline 修改次数 < 3, 视为常态 (无需自检)"
fi
echo ""
echo "[lifecycle-gate] --- R10: evidence_archive 已有 .archived 锁 ---"
r10_count=0
for id in "${!LIFECYCLE_ROLE[@]}"; do
    role="${LIFECYCLE_ROLE[$id]}"
    [[ "$role" != "evidence_archive" ]] && continue
    path="${LIFECYCLE_PATH[$id]}"
    case "$path" in
        skills/*) continue ;;
    esac
    gpath=$(echo "$path" | sed -E 's/\{iter\}//g; s/\{slug\}//g; s/\{component\}//g; s/\*.*$//')
    real_gpath="$PROJECT_ROOT/${gpath#.shadow/}"
    if [[ -e "$real_gpath" ]]; then
        archived=$(find "$real_gpath" -name "*.archived" 2>/dev/null | wc -l)
        total_in=$(find "$real_gpath" -type f 2>/dev/null | wc -l)
        if [[ $total_in -gt 0 ]]; then
            r10_count=$((r10_count+1))
            echo "  $id: $archived / $total_in 文件已锁"
        fi
    fi
done
if [[ $r10_count -eq 0 ]]; then
    echo "  (无 evidence_archive 实物, 跳过)"
fi

# ───────── R6: 路径 locality (.shadow/ 下非 canonical 文件) ─────────
echo ""
echo "[lifecycle-gate] --- R6: 路径 locality (.shadow/ 下非 canonical 文件) ---"
r6_drift=0
if [[ -d "$shadow_dir" ]]; then
    # 收集所有 canonical_path (含 aliases) 展开后的目录
    declare -A known_dirs=()
    # 用 tab 分隔 (jq 输出用 @tsv 强制 tab)
    while IFS=$'\t' read -r role path; do
        [[ -z "$path" ]] && continue
        # 提取第一段目录
        first_dir=$(echo "$path" | sed -E 's|^\.?/?\.shadow/||; s|/.*$||')
        [[ -n "$first_dir" ]] && known_dirs["$first_dir"]=1
        # 也登记 aliases 里的目录
        for alias in $(jq -r --arg id "$(jq -r --arg p "$path" '.lifecycle_artifacts.artifacts[] | select(.canonical_path == $p) | .id' "$SCHEMA")" '.lifecycle_artifacts.artifacts[] | select(.id == $id) | (.aliases // [])[]' "$SCHEMA" 2>/dev/null); do
            ad=$(echo "$alias" | sed -E 's|^\.?/?\.shadow/||; s|/.*$||')
            [[ -n "$ad" ]] && known_dirs["$ad"]=1
        done
    done < <(jq -r '.lifecycle_artifacts.artifacts[] | select(.role != "template_instance") | [.role, .canonical_path] | @tsv' "$SCHEMA")

    # 扫 .shadow/ 下所有目录
    while IFS= read -r d; do
        [[ -z "$d" ]] && continue
        rel="${d#$shadow_dir/}"
        first="${rel%%/*}"
        if [[ -z "${known_dirs[$first]:-}" ]]; then
            echo "  ⚠️  R6: 未知目录 .shadow/$first/ (不在 schema canonical 或 aliases)"
            r6_drift=$((r6_drift+1))
        fi
    done < <(find "$shadow_dir" -mindepth 1 -maxdepth 2 -type d 2>/dev/null)

    if [[ $r6_drift -eq 0 ]]; then
        echo "  ✓ R6: .shadow/ 下所有顶层目录都在 schema 登记"
    else
        echo "  R6 漂移: $r6_drift 个未知目录"
    fi
fi

# ───────── 总结 ─────────
echo ""
echo "[lifecycle-gate] === 检查完成 ==="
echo "  R1 设计基线改动传播: $r1_warn 警告 (advisory)"
echo "  R3 证据写阻断: $violations 修复 (硬门禁)"
echo "  R5 漂移扫描: $r5_status (识别率 $pct%, 阈值 80%)"
echo "  R6 路径 locality: $r6_drift 漂移"
echo "  R10 自动归档: $r10_count 路径已检查"
echo ""

# R5 硬阻断: 识别率 < 80% 且 .shadow/LIFECYCLE.md 存在 (新项目)
# R3 硬阻断: evidence_archive 被改写 (违反只读, 累计 ≥ 3 次)
# R5 advisory (老项目): 降级为提示, exit 0
if [[ "$r5_status" == "fail" ]]; then
    echo "[lifecycle-gate] ❌ R5 硬门禁触发 (新项目识别率 < 80%), exit 1"
    exit 1
fi
if [[ $R3_HARD_BLOCK -eq 1 ]]; then
    echo "[lifecycle-gate] ❌ R3 硬门禁触发 (evidence_archive 累计可写 ≥ 3 次), exit 1"
    echo "[lifecycle-gate]    处置: 1) 确认是 iter 冻结用 R10 ('bash init.sh --archive-old') / 2) 否则 chmod 644 后人工 review 证据"
    exit 1
fi
if [[ $violations -gt 0 ]]; then
    echo "[lifecycle-gate] ❌ R3 硬门禁触发 (evidence_archive 写违反), exit 1"
    exit 1
fi
if [[ "$r5_status" == "advisory" ]]; then
    echo "[lifecycle-gate] ⚠️  R5 老项目 advisory (识别率 < 80%, 无 LIFECYCLE.md), exit 0"
    exit 0
fi

echo "[lifecycle-gate] ✓ 5 角色一致性通过, exit 0"
exit 0
