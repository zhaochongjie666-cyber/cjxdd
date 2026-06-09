#!/bin/bash
# xdd-gate-wire-validate.sh — Phase 2 wire 12 门禁自动检查
# session c3692b46 教训: walker 12 门禁 11 失败, 这次 hook 自动卡
#
# 12 门禁:
#  1.  em-dash 字符 0 命中 (—)
#  2.  data-page 标注 ≥ 8 个组件
#  3.  data-state 标注 ≥ 4 个状态
#  4.  accent color 4 种 (blue/red/green/yellow)
#  5.  字体 system-ui sans-serif
#  6.  mobile SVG (1 份 ≤ 375px 宽)
#  7.  desktop SVG (1 份 ≥ 1024px 宽)
#  8.  viewBox 必有
#  9.  aria-label 所有交互元素
# 10.  焦点态 :focus 样式可见
# 11.  错误态 .error 状态明确
# 12.  loading 态 .loading 状态明确

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

is_meta_project && exit 0

xdd_dir=$(get_xdd_dir)
[[ -z "$xdd_dir" ]] && exit 2

wire_dir="$xdd_dir/wire"
design_dir="$xdd_dir/design"

# 实战发现: 之前只扫 .xdd/wire/, 漏 .xdd/design/*.svg (实战产物放 design/)
# 修法: 都扫
if [[ ! -d "$wire_dir" && ! -d "$design_dir" ]]; then
    echo "[xdd] (无 .xdd/wire/ 和 .xdd/design/, 纯后端项目跳过 wire 12 门禁)"
    exit 0
fi

# 收齐所有 SVG (从 .xdd/wire/ 和 .xdd/design/)
svgs=""
if [[ -d "$wire_dir" ]]; then
    svgs="$svgs $(find "$wire_dir" -name "*.svg" -type f 2>/dev/null)"
fi
if [[ -d "$design_dir" ]]; then
    svgs="$svgs $(find "$design_dir" -name "*.svg" -type f 2>/dev/null)"
fi
svgs=$(echo "$svgs" | xargs)  # trim whitespace

if [[ -z "$svgs" ]]; then
    echo "[xdd] ❌ wire 12 门禁: .xdd/wire/ 和 .xdd/design/ 都无 SVG 文件" >&2
    exit 2
fi

echo "[xdd] (扫 $svgs 共 $(echo $svgs | wc -w) 份 SVG)"

# 12 门禁逐一查
declare -a failed_gates=()
total_checks=0

# 1. em-dash (—) 必须 0
em_count=$(grep -c "—" $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
total_checks=$((total_checks+1))
if [[ ${em_count:-0} -gt 0 ]]; then
    failed_gates+=("1. em-dash 字符: ${em_count} 命中 (要求 0)")
fi

# 2. data-page ≥ 8
data_page_count=$(grep -cE 'data-page' $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s}')
total_checks=$((total_checks+1))
if [[ ${data_page_count:-0} -lt 8 ]]; then
    failed_gates+=("2. data-page 标注: ${data_page_count:-0} (要求 ≥ 8)")
fi

# 3. data-state ≥ 4
data_state_count=$(grep -cE 'data-state' $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s}')
total_checks=$((total_checks+1))
if [[ ${data_state_count:-0} -lt 4 ]]; then
    failed_gates+=("3. data-state 标注: ${data_state_count:-0} (要求 ≥ 4)")
fi

# 4. accent color 4 种
accent_count=0
for c in "blue" "red" "green" "yellow"; do
    if grep -qiE "#?(3b82f6|ef4444|10b981|eab308|$c)" $svgs 2>/dev/null; then
        ((accent_count++)) || true
    fi
done
total_checks=$((total_checks+1))
if [[ $accent_count -lt 4 ]]; then
    failed_gates+=("4. accent color: $accent_count 种 (要求 4: blue/red/green/yellow)")
fi

# 5. 字体 system-ui
font_ok=$(grep -cE 'system-ui|sans-serif' $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s}')
total_checks=$((total_checks+1))
if [[ ${font_ok:-0} -eq 0 ]]; then
    failed_gates+=("5. 字体: 无 system-ui / sans-serif 引用 (要求 system-ui sans-serif)")
fi

# 6. mobile SVG (1 份 ≤ 375px 宽)
mobile_count=0
for svg in $svgs; do
    width=$(grep -oE 'width="[0-9]+"' "$svg" | head -1 | grep -oE '[0-9]+' || echo "0")
    if [[ $width -gt 0 && $width -le 375 ]]; then
        ((mobile_count++)) || true
    fi
done
total_checks=$((total_checks+1))
if [[ $mobile_count -eq 0 ]]; then
    failed_gates+=("6. mobile SVG: 0 份 ≤ 375px 宽 (要求 ≥ 1 份)")
fi

# 7. desktop SVG (1 份 ≥ 1024px 宽)
desktop_count=0
for svg in $svgs; do
    width=$(grep -oE 'width="[0-9]+"' "$svg" | head -1 | grep -oE '[0-9]+' || echo "0")
    if [[ $width -ge 1024 ]]; then
        ((desktop_count++)) || true
    fi
done
total_checks=$((total_checks+1))
if [[ $desktop_count -eq 0 ]]; then
    failed_gates+=("7. desktop SVG: 0 份 ≥ 1024px 宽 (要求 ≥ 1 份)")
fi

# 8. viewBox 必有
viewbox_count=0
total_svgs=0
for svg in $svgs; do
    ((total_svgs++)) || true
    if grep -qE 'viewBox' "$svg"; then
        ((viewbox_count++)) || true
    fi
done
total_checks=$((total_checks+1))
if [[ $total_svgs -gt 0 && $viewbox_count -lt $total_svgs ]]; then
    failed_gates+=("8. viewBox: $viewbox_count/$total_svgs SVG 有 viewBox (要求全部)")
fi

# 9. aria-label 覆盖所有交互元素
# 简化: 至少有 aria-label 出现
aria_count=$(grep -cE 'aria-label' $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s}')
total_checks=$((total_checks+1))
if [[ ${aria_count:-0} -eq 0 ]]; then
    failed_gates+=("9. aria-label: 0 命中 (要求所有交互元素标注)")
fi

# 10. 焦点态 :focus
focus_count=$(grep -cE ':focus' $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s}')
total_checks=$((total_checks+1))
if [[ ${focus_count:-0} -eq 0 ]]; then
    failed_gates+=("10. 焦点态 :focus: 0 命中 (要求可见)")
fi

# 11. 错误态 .error
error_count=$(grep -cE '\.error|class="[^"]*error' $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s}')
total_checks=$((total_checks+1))
if [[ ${error_count:-0} -eq 0 ]]; then
    failed_gates+=("11. 错误态 .error: 0 命中 (要求明确)")
fi

# 12. loading 态
loading_count=$(grep -cE '\.loading|class="[^"]*loading' $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s}')
total_checks=$((total_checks+1))
if [[ ${loading_count:-0} -eq 0 ]]; then
    failed_gates+=("12. loading 态: 0 命中 (要求明确)")
fi

# 输出
passed=$((12 - ${#failed_gates[@]}))
if [[ ${#failed_gates[@]} -eq 0 ]]; then
    echo "[xdd] ✓ wire 12 门禁: 12/12 全过"
    exit 0
else
    echo "[xdd] ❌ wire 12 门禁: $passed/12 过, ${#failed_gates[@]} 门禁失败" >&2
    for g in "${failed_gates[@]}"; do
        echo "[xdd]    - $g" >&2
    done
    echo "[xdd]    修法: 加载 xdd-wire skill 重新设计, session c3692b46 教训: 12 门禁不能放过" >&2
    exit 2
fi
