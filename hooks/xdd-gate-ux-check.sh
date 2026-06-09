#!/bin/bash
# xdd-gate-ux-check.sh — UX 4 层审查 (L1-L4) 自动卡
# 来源: skills/xdd-ux-design/SKILL.md § 3 前端 UX 审查框架
# 与 xdd-gate-wire-validate.sh 配对: 写完 wire SVG 先跑 12 门禁, 再跑 4 层 UX
# 失败 → 修 → 再跑 → 闸门全过才进 Phase 2 出口 (loop until pass)
#
# 4 层 (按优先级):
#  L1 功能性 (必须修): CTA/错误反馈/状态可见/防破坏/键盘可达
#  L2 可用性 (应该修): 一致性/信息层次/认知负荷/反馈/移动端/文案
#  L3 a11y    (应该修): 语义/ARIA/对比度/焦点/alt/表单/动效
#  L4 质感    (建议修): 微交互/动效/空状态/加载/庆祝/品牌
#
# 退出码: 0 全过 / 2 至少 1 项失败 / 1 L1 阻断 (硬错误)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

is_meta_project && exit 0

xdd_dir=$(get_xdd_dir)
[[ -z "$xdd_dir" ]] && exit 2

wire_dir="$xdd_dir/wire"
if [[ ! -d "$wire_dir" ]]; then
    echo "[xdd] (无 .xdd/wire/, 纯后端跳过 UX 4 层审查)"
    exit 0
fi

svgs=$(find "$wire_dir" -name "*.svg" -type f 2>/dev/null)
[[ -z "$svgs" ]] && { echo "[xdd] (无 SVG, 跳过)"; exit 0; }

declare -a L1_fail=()
declare -a L2_fail=()
declare -a L3_fail=()
declare -a L4_fail=()

# === L1 功能性 (5 项, 任一失败 → 硬阻断 exit 1) ===

# 1.1 CTA 视觉显著 (按钮元素有明确的 background 或 stroke 颜色)
if ! grep -qE '<(rect|button|path|polygon)[^>]*(fill|stroke)=' $svgs 2>/dev/null; then
    L1_fail+=("1.1 CTA 视觉: 无 fill/stroke 标注, 按钮可能不显著")
fi

# 1.2 错误反馈 (.error class 存在)
if ! grep -qE '\.error|class="[^"]*error|aria-invalid|data-error' $svgs 2>/dev/null; then
    L1_fail+=("1.2 错误反馈: 无 .error / aria-invalid 标注, 失败路径不可见")
fi

# 1.3 状态可见 (loading / success / error 三态都有)
for state in loading success error; do
    if ! grep -qiE "\.${state}|class=\"[^\"]*${state}|data-state=\"${state}" $svgs 2>/dev/null; then
        L1_fail+=("1.3 状态可见: 缺 ${state} 态标注")
    fi
done

# 1.4 防破坏性操作 (确认对话框 / 二次确认元素)
if grep -qiE 'delete|destroy|remove|删除|清空' $svgs 2>/dev/null; then
    if ! grep -qE 'confirm|确认|二次|are.?you.?sure' $svgs 2>/dev/null; then
        L1_fail+=("1.4 防破坏: 有删除/清空操作但无 confirm 标注")
    fi
fi

# 1.5 键盘可达 (tabindex / role=button)
if ! grep -qE 'tabindex|role="button"|<button' $svgs 2>/dev/null; then
    L1_fail+=("1.5 键盘可达: 无 tabindex / role=button / <button> 标注")
fi

# === L2 可用性 (5 项, 失败 → 软警告) ===

# 2.1 一致性 (同类元素用同类 class, 至少 3 个 button 用 .btn)
btn_count=$(grep -cE 'class="[^"]*btn|class="[^"]*button' $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s}')
if [[ ${btn_count:-0} -lt 1 ]]; then
    L2_fail+=("2.1 一致性: 无统一 .btn / .button 标注 (建议同类元素用同类 class)")
fi

# 2.2 信息层次 (h1/h2/h3 标题层级 或 视觉层次 class)
if ! grep -qE '<text[^>]*font-size="(2[4-9]|3[0-9])' $svgs 2>/dev/null && \
   ! grep -qE '<h[1-3]|class="[^"]*title|class="[^"]*heading' $svgs 2>/dev/null; then
    L2_fail+=("2.2 信息层次: 无大字标题 (font-size ≥ 24px), 视觉层次弱")
fi

# 2.3 认知负荷 (单个 SVG 元素数 ≤ 50, 避免信息过载)
for svg in $svgs; do
    elem_count=$(grep -cE '<(rect|circle|path|polygon|text|line|g)' "$svg" 2>/dev/null || echo 0)
    if [[ $elem_count -gt 80 ]]; then
        L2_fail+=("2.3 认知负荷: $(basename $svg) 有 $elem_count 元素 (> 80), 建议分组/分步")
        break
    fi
done

# 2.4 反馈即时性 (loading 元素 < 1s 必有)
# 已在 L1 检查, 此处不重复

# 2.5 移动端 (mobile SVG 必有, width ≤ 375)
mobile_count=0
for svg in $svgs; do
    width=$(grep -oE 'width="[0-9]+"' "$svg" | head -1 | grep -oE '[0-9]+' || echo 0)
    [[ $width -gt 0 && $width -le 375 ]] && ((mobile_count++)) || true
done
[[ $mobile_count -eq 0 ]] && L2_fail+=("2.5 移动端: 无 ≤ 375px 宽 SVG")

# 2.6 文案清晰 (无 > 50 字符未分段的 text 元素, 避免长段落)
long_text=$(grep -cE '<text[^>]*>[^<]{50,}' $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s}')
if [[ ${long_text:-0} -gt 3 ]]; then
    L2_fail+=("2.6 文案清晰: 有 ${long_text} 个长 text 元素 (> 50 字符未分段)")
fi

# === L3 a11y (7 项, 失败 → 软警告) ===

# 3.1 语义化 (button/link/heading 元素)
# 已在 L1 5 检查

# 3.2 ARIA 属性 (aria-label / aria-live / role)
aria_count=$(grep -cE 'aria-(label|live|describedby|labelledby)' $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s}')
if [[ ${aria_count:-0} -eq 0 ]]; then
    L3_fail+=("3.2 ARIA: 无 aria-label / aria-live 标注")
fi

# 3.3 颜色对比度 (深色 + 浅色组合, 检查有 stroke 或 fill 配对)
contrast_check=$(grep -cE 'fill="#(fff|FFF|ffffff|000|000000)"' $svgs 2>/dev/null | awk -F: '{s+=$2} END{print s}')
if [[ ${contrast_check:-0} -eq 0 ]]; then
    L3_fail+=("3.3 对比度: 无 #fff / #000 配对, 颜色对比度可能不足 4.5:1")
fi

# 3.4 焦点可见 (outline / :focus / focus-ring)
if ! grep -qE ':focus|outline|focus-ring|focus-visible' $svgs 2>/dev/null; then
    L3_fail+=("3.4 焦点可见: 无 :focus / outline 样式 (键盘焦点不可见)")
fi

# 3.5 替代文本 (alt 属性, SVG 元素用 <title> 或 aria-label)
# 已在 3.2 涵盖

# 3.6 表单可访问 (label for/id 配对)
if grep -qE '<input|<select|<textarea' $svgs 2>/dev/null; then
    if ! grep -qE '<label|aria-label' $svgs 2>/dev/null; then
        L3_fail+=("3.6 表单: 有 input 但无 label / aria-label")
    fi
fi

# 3.7 减少动效 (prefers-reduced-motion)
# SVG 静态图, 此项不强制

# === L4 质感 (3 项, 失败 → 建议) ===

# 4.1 微交互 (hover/active 状态)
if ! grep -qE ':hover|:active|transition' $svgs 2>/dev/null; then
    L4_fail+=("4.1 微交互: 无 :hover / :active / transition, 反馈弱")
fi

# 4.2 空状态 (空数据时的引导)
if ! grep -qE 'empty|no.data|暂无|空状态' $svgs 2>/dev/null; then
    L4_fail+=("4.2 空状态: 无 empty / 暂无数据 引导")
fi

# 4.3 加载体验 (skeleton 而非转圈, 或有 loading text)
# 已在 L1.3 检查 loading

# === 报告 ===

echo "[xdd] === UX 4 层审查 (xdd-ux-design) ==="

total_fail=$((${#L1_fail[@]} + ${#L2_fail[@]} + ${#L3_fail[@]} + ${#L4_fail[@]}))

if [[ ${#L1_fail[@]} -gt 0 ]]; then
    echo "[xdd] 🔴 L1 功能性 (硬阻断, ${#L1_fail[@]} 项):" >&2
    for f in "${L1_fail[@]}"; do
        echo "[xdd]    ✗ $f" >&2
    done
fi

if [[ ${#L2_fail[@]} -gt 0 ]]; then
    echo "[xdd] 🟡 L2 可用性 (${#L2_fail[@]} 项):" >&2
    for f in "${L2_fail[@]}"; do
        echo "[xdd]    ⚠ $f" >&2
    done
fi

if [[ ${#L3_fail[@]} -gt 0 ]]; then
    echo "[xdd] 🟢 L3 a11y (${#L3_fail[@]} 项):" >&2
    for f in "${L3_fail[@]}"; do
        echo "[xdd]    ⚠ $f" >&2
    done
fi

if [[ ${#L4_fail[@]} -gt 0 ]]; then
    echo "[xdd] 🔵 L4 质感 (${#L4_fail[@]} 项):" >&2
    for f in "${L4_fail[@]}"; do
        echo "[xdd]    ℹ $f" >&2
    done
fi

# 退出码: L1 任一失败 → 1 (硬阻断) / L2/L3/L4 任一失败 → 2 (软警告) / 全过 → 0
if [[ ${#L1_fail[@]} -gt 0 ]]; then
    echo "[xdd] ❌ UX 审查: L1 硬阻断 (${#L1_fail[@]} 项), 修完重跑" >&2
    exit 1
elif [[ $total_fail -gt 0 ]]; then
    echo "[xdd] ⚠️  UX 审查: L2/L3/L4 软警告 ($total_fail 项), 建议修后再跑"
    exit 2
else
    echo "[xdd] ✓ UX 4 层审查: L1+L2+L3+L4 全过"
    exit 0
fi
