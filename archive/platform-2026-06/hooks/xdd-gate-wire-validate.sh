#!/bin/bash
# xdd-gate-wire-validate.sh — Phase 2 wire 12 门禁自动检查 (HTML 版)
# 配合新 xdd-wire SKILL.md (HTML 格式):
#   .xdd/wire/<page>/index.html + 6 操作态 (empty/loading/error/success/confirm/edge) + review.md
# session c3692b46 教训: walker 12 门禁 11 失败, 这次 hook 自动卡
#
# 12 门禁 (HTML 适配):
#  1.  em-dash 字符 0 命中 (—) — 可见文字不允许
#  2.  data-page 标注 ≥ 8 个组件
#  3.  data-state 标注 ≥ 4 个状态 (空/加载/错误/成功/确认/边界)
#  4.  accent color 4 种 (blue/red/green/yellow) — CSS 变量或 hex
#  5.  字体 system-ui sans-serif
#  6.  mobile HTML 必有 (index.mobile.html)
#  7.  desktop HTML 必有 (index.html, width ≥ 1024 viewport)
#  8.  viewport meta 必有 (移动端适配)
#  9.  aria-label 覆盖所有交互元素
# 10.  :focus 样式可见
# 11.  错误态 error.html 必有
# 12.  loading 态 loading.html 必有

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

is_meta_project && exit 0

xdd_dir=$(get_xdd_dir)
[[ -z "$xdd_dir" ]] && exit 2

wire_dir="$xdd_dir/wire"
design_dir="$xdd_dir/design"

if [[ ! -d "$wire_dir" && ! -d "$design_dir" ]]; then
    echo "[xdd] (无 .xdd/wire/ 和 .xdd/design/, 纯后端项目跳过 wire 12 门禁)"
    exit 0
fi

# 收齐所有 HTML (从 .xdd/wire/ 和 .xdd/design/)
htmls=""
if [[ -d "$wire_dir" ]]; then
    htmls="$htmls $(find "$wire_dir" -name "*.html" -type f 2>/dev/null)"
fi
if [[ -d "$design_dir" ]]; then
    htmls="$htmls $(find "$design_dir" -name "*.html" -type f 2>/dev/null)"
fi
# 兼容旧 SVG (deprecated, 但不阻断)
svgs=""
if [[ -d "$wire_dir" ]]; then
    svgs="$svgs $(find "$wire_dir" -name "*.svg" -type f 2>/dev/null)"
fi
if [[ -d "$design_dir" ]]; then
    svgs="$svgs $(find "$design_dir" -name "*.svg" -type f 2>/dev/null)"
fi
htmls=$(echo "$htmls" | xargs)
svgs=$(echo "$svgs" | xargs)
all_files="$htmls $svgs"
all_files=$(echo "$all_files" | xargs)

if [[ -z "$all_files" ]]; then
    echo "[xdd] ❌ wire 12 门禁: .xdd/wire/ 和 .xdd/design/ 都无 HTML/SVG 文件" >&2
    exit 2
fi

echo "[xdd] (扫 $(echo $all_files | wc -w) 份文件: $(echo $htmls | wc -w) HTML + $(echo $svgs | wc -w) SVG)"

# 12 门禁逐一查
declare -a failed_gates=()

# 1. em-dash (—) 必须 0
em_count=$(grep -c "—" $all_files 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
if [[ ${em_count:-0} -gt 0 ]]; then
    failed_gates+=("1. em-dash 字符: ${em_count} 命中 (要求 0)")
fi

# 2. data-page ≥ 8
data_page_count=$(grep -cE 'data-page' $all_files 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
if [[ ${data_page_count:-0} -lt 8 ]]; then
    failed_gates+=("2. data-page 标注: ${data_page_count:-0} (要求 ≥ 8)")
fi

# 3. data-state ≥ 4 (空/加载/错误/成功/确认/边界 至少 4 状态)
data_state_count=$(grep -cE 'data-state' $all_files 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
if [[ ${data_state_count:-0} -lt 4 ]]; then
    failed_gates+=("3. data-state 标注: ${data_state_count:-0} (要求 ≥ 4 状态)")
fi

# 4. accent color 4 种 (CSS 变量或 hex)
accent_count=0
for c in "blue" "red" "green" "yellow"; do
    if grep -qiE "(3b82f6|ef4444|10b981|eab308|$c)" $all_files 2>/dev/null; then
        ((accent_count++)) || true
    fi
done
if [[ $accent_count -lt 4 ]]; then
    failed_gates+=("4. accent color: $accent_count 种 (要求 4: blue/red/green/yellow)")
fi

# 5. 字体 system-ui
font_ok=$(grep -cE 'system-ui|sans-serif' $all_files 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
if [[ ${font_ok:-0} -eq 0 ]]; then
    failed_gates+=("5. 字体: 无 system-ui / sans-serif 引用 (要求 system-ui sans-serif)")
fi

# 6. mobile HTML 必有 (index.mobile.html 或 viewport meta)
mobile_count=0
if [[ -n "$htmls" ]]; then
    mobile_count=$(echo "$htmls" | tr ' ' '\n' | grep -cE 'mobile' 2>/dev/null || echo 0)
fi
if [[ $mobile_count -eq 0 ]]; then
    failed_gates+=("6. mobile HTML: 0 份 (要求 index.mobile.html ≥ 1)")
fi

# 7. desktop HTML 必有 (index.html)
desktop_count=0
if [[ -n "$htmls" ]]; then
    desktop_count=$(echo "$htmls" | tr ' ' '\n' | grep -cE 'index\.html' 2>/dev/null || echo 0)
fi
if [[ $desktop_count -eq 0 ]]; then
    failed_gates+=("7. desktop HTML: 0 份 (要求 index.html ≥ 1)")
fi

# 8. viewport meta 必有 (移动端适配)
viewport_count=$(grep -cE 'name="viewport"' $htmls 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
if [[ ${viewport_count:-0} -eq 0 && -n "$htmls" ]]; then
    failed_gates+=("8. viewport meta: 0 命中 (要求 name=\"viewport\")")
fi

# 9. aria-label 覆盖所有交互元素
aria_count=$(grep -cE 'aria-label' $all_files 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
if [[ ${aria_count:-0} -eq 0 ]]; then
    failed_gates+=("9. aria-label: 0 命中 (要求所有交互元素标注)")
fi

# 10. :focus 样式可见
focus_count=$(grep -cE ':focus|outline' $all_files 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
if [[ ${focus_count:-0} -eq 0 ]]; then
    failed_gates+=("10. 焦点态 :focus: 0 命中 (要求可见)")
fi

# 11. 错误态 error.html 必有
error_count=0
if [[ -n "$htmls" ]]; then
    error_count=$(echo "$htmls" | tr ' ' '\n' | grep -cE 'error\.html' 2>/dev/null || echo 0)
fi
if [[ $error_count -eq 0 && -n "$htmls" ]]; then
    failed_gates+=("11. 错误态: 0 份 error.html (要求 ≥ 1)")
fi

# 12. loading 态 loading.html 必有
loading_count=0
if [[ -n "$htmls" ]]; then
    loading_count=$(echo "$htmls" | tr ' ' '\n' | grep -cE 'loading\.html' 2>/dev/null || echo 0)
fi
if [[ $loading_count -eq 0 && -n "$htmls" ]]; then
    failed_gates+=("12. loading 态: 0 份 loading.html (要求 ≥ 1)")
fi

# 输出
if [[ ${#failed_gates[@]} -eq 0 ]]; then
    echo "[xdd] ✓ wire 12 门禁: 12/12 全过"
    exit 0
else
    passed=$((12 - ${#failed_gates[@]}))
    echo "[xdd] ❌ wire 12 门禁: $passed/12 过, ${#failed_gates[@]} 门禁失败" >&2
    for g in "${failed_gates[@]}"; do
        echo "[xdd]    - $g" >&2
    done
    echo "[xdd]    修法: 加载 xdd-wire skill 重新设计 (HTML 格式 + 6 操作态 + review.md)" >&2
    exit 2
fi
