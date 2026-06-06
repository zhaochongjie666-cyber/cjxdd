#!/bin/bash
# gate-check-l3.sh — Soft gate for L3 韧性层 (advisory only, never blocks)
#
# Triggered: 手工跑 (L3 skill 完成后)
# 用法: bash skills/shadow-l3-resilience/scripts/gate-check-l3.sh <slug>
#
# 软门禁: 缺文件 / 不达标 → 打印警告, exit 0 (永远不阻塞)
# 硬门禁: 由 shadow-schema.json 的 scale.l3_required 强制 (status.md 模板必含 L3 行)
#
# 扩展模式 (l3_extended_mode=true, L 规模): 9 维度 + 12 模式 + 8 字段强校验

set -e

slug="${1:?Usage: gate-check-l3.sh <slug>}"
base=".shadow/L3-resilience/BXX-${slug}"
project_root="${PROJECT_ROOT:-$(pwd)}"
scale_file="$project_root/.shadow/scale.md"

echo "[L3 SOFT_GATE] 检查 $slug 的 L3 产出"

# 检测 l3_extended_mode
extended_mode=false
if [[ -f "$scale_file" ]] && grep -qE "l3_extended_mode:\s*true" "$scale_file"; then
  extended_mode=true
  echo "[L3 SOFT_GATE] ⚡ 检测到 scale.l3_extended_mode=true, 启用 L 规模扩展模式"
fi

# 必填 5 份
required=(
  "failure-modes.md"
  "failsafe-design.md"
  "chaos-scenarios.md"
  "resilience-test-plan.md"
  "recovery-runbook.md"
)
missing=()

if [[ -d "$base" ]]; then
  for f in "${required[@]}"; do
    [[ -f "$base/$f" ]] || missing+=("$f")
  done
else
  missing=("${required[@]}")
fi

# 报告缺失
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "[L3 SOFT_GATE] ⚠️  缺 ${#missing[@]} 份产出: ${missing[*]}"
  echo "[L3 SOFT_GATE] 软门禁: 不阻塞流水线, 但 L5 计划兜底约束段会缺少数据源"
  exit 0
fi

# 最低行数检查
fm_lines=$(wc -l < "$base/failure-modes.md")
fs_lines=$(wc -l < "$base/failsafe-design.md")
cs_lines=$(wc -l < "$base/chaos-scenarios.md")
rt_lines=$(wc -l < "$base/resilience-test-plan.md")
rb_lines=$(wc -l < "$base/recovery-runbook.md")

# @chaos 标签数
chaos_count=$(grep -c "@chaos" "$base/chaos-scenarios.md" 2>/dev/null || echo 0)

# 9 维度覆盖 (含跨地域)
dim_count=$(grep -cE "^\| *(调度|网络|状态|资源|数据|事件|依赖|流量|跨地域)" "$base/failure-modes.md" 2>/dev/null || echo 0)
cross_region_dim=$(grep -cE "^\| *跨地域" "$base/failure-modes.md" 2>/dev/null || echo 0)

# 失败模式 ID 数 (FXX)
fxx_count=$(grep -cE "^\| *F[0-9][0-9]" "$base/failure-modes.md" 2>/dev/null || echo 0)
cross_region_fxx=$(grep -cE "^\| *F8[1-5]" "$base/failure-modes.md" 2>/dev/null || echo 0)

# 兜底策略 ID 数 (FSXX)
fsxx_count=$(grep -cE "^\| *FS[0-9][0-9]" "$base/failsafe-design.md" 2>/dev/null || echo 0)
fs11_count=$(grep -cE "FS11[ -]|业务对账" "$base/failsafe-design.md" 2>/dev/null || echo 0)
fs12_count=$(grep -cE "FS12[ -]|业务幂等" "$base/failsafe-design.md" 2>/dev/null || echo 0)

# FMEA 8 字段 (扩展模式): 表格列数
fmea_columns=$(awk -F'|' '/^\| *F[0-9][0-9]/ && /\./ { gsub(/^ +| +$/, "", $2); if (NF >= 11) print "8+"; else print NF-2; exit }' "$base/failure-modes.md" 2>/dev/null || echo "0")

# 报告状态
echo "[L3 SOFT_GATE] $slug:"
echo "  - failure-modes: $fm_lines 行, $fxx_count 个失败模式, 9 维度覆盖 $dim_count (含跨地域: $cross_region_dim)"
echo "  - failsafe-design: $fs_lines 行, $fsxx_count 个兜底策略 (FS11 业务对账: $fs11_count, FS12 业务幂等: $fs12_count)"
echo "  - chaos-scenarios: $cs_lines 行, $chaos_count 个 @chaos 场景 (F8X 跨地域: $cross_region_fxx)"
echo "  - resilience-test-plan: $rt_lines 行"
echo "  - recovery-runbook: $rb_lines 行"

# 质量警告 (软门禁: 不阻塞, 只提示)
warnings=()
[[ $fm_lines -lt 80 ]] && warnings+=("failure-modes < 80 行")
[[ $fs_lines -lt 50 ]] && warnings+=("failsafe-design < 50 行")
[[ $chaos_count -lt 3 ]] && warnings+=("@chaos 场景 < 3 个")
[[ $rb_lines -lt 30 ]] && warnings+=("recovery-runbook < 30 行")
[[ $dim_count -lt 4 ]] && warnings+=("8 维度覆盖 < 4 (S 规模最低)")
[[ $dim_count -lt 6 ]] && warnings+=("8 维度覆盖 < 6 (M/L 规模建议)")
[[ $fxx_count -lt 5 ]] && warnings+=("失败模式 < 5 (S 规模最低)")
[[ $fxx_count -lt 10 ]] && warnings+=("失败模式 < 10 (M/L 规模建议)")
[[ $fsxx_count -lt 5 ]] && warnings+=("兜底策略 < 5")

# 扩展模式 (L 规模) 额外警告
if [[ "$extended_mode" == "true" ]]; then
  [[ $dim_count -lt 6 ]] && warnings+=("L 规模: 9 维度覆盖 < 6 (l3_extended_mode 要求)")
  [[ $cross_region_dim -lt 1 ]] && warnings+=("L 规模: 维度 9 跨地域/多活 未覆盖 (硬要求)")
  [[ $cross_region_fxx -lt 1 ]] && warnings+=("L 规模: 跨地域 F8X 失败模式未识别")
  [[ $fs11_count -lt 1 ]] && warnings+=("L 规模: FS11 业务对账 兜底策略未识别 (硬要求)")
  [[ $fs12_count -lt 1 ]] && warnings+=("L 规模: FS12 业务幂等 兜底策略未识别 (硬要求)")
  [[ "$fmea_columns" != "8+" && "$fmea_columns" != "11" && "$fmea_columns" != "12" ]] && warnings+=("L 规模: FMEA 表格列数 $fmea_columns (期望 8+ 列含扩展字段)")
  # L 规模 P0 @chaos 场景数 (含跨地域 5)
  [[ $chaos_count -lt 16 ]] && warnings+=("L 规模: @chaos 场景 < 16 (期望 11 标准 + 5 跨地域)")
fi

if [[ ${#warnings[@]} -gt 0 ]]; then
  echo ""
  echo "[L3 SOFT_GATE] ⚠️  质量警告 (${#warnings[@]} 项):"
  for w in "${warnings[@]}"; do
    echo "    - $w"
  done
  echo ""
  if [[ "$extended_mode" == "true" ]]; then
    echo "[L3 SOFT_GATE] 软门禁: 不阻塞, 但 L 规模 l3_extended_mode=true 时建议补全"
  else
    echo "[L3 SOFT_GATE] 软门禁: 不阻塞, 但建议补全后让 L5/L6 有更完整数据源"
  fi
else
  echo ""
  echo "[L3 SOFT_GATE] ✓ 5 份产出齐全, 质量达标"
fi

# 永远 exit 0
exit 0
