#!/usr/bin/env bash
# mmdc_check.sh — 验证 .xdd/design/architecture/{bxx-slug}/flow.mermaid 能否渲染
# 扫描所有业务线 slug 的 flow.mermaid，逐个用 mmdc 渲染验证。
set -euo pipefail

MMDC="${MMDC:-$(which mmdc 2>/dev/null || echo '')}"
XDD_DIR="${1:-${XDD_DIR:-.xdd}}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

PASS=0
FAIL=0

if [ -z "$MMDC" ]; then
    echo -e "${RED}mmdc (mermaid-cli) not found. Install: npm install -g @mermaid-js/mermaid-cli${NC}"
    exit 1
fi

check_with_mmdc() {
    local file="$1"
    local label="$2"
    local tmpout="$(mktemp /tmp/_mmdc_XXXXXX.svg)"

    if "$MMDC" -i "$file" -o "$tmpout" -q 2>&1; then
        echo -e "  ${GREEN}PASS${NC} mmdc: '${label}' renders OK"
        PASS=$((PASS+1))
    else
        echo -e "  ${RED}FAIL${NC} mmdc: '${label}' has parse errors"
        FAIL=$((FAIL+1))
    fi
    rm -f "$tmpout"
}

echo "=== Mermaid Render Validation (mmdc) ==="
echo ""

arch_dir="${XDD_DIR}/design/architecture"
if [ ! -d "$arch_dir" ]; then
    echo -e "${YELLOW}${arch_dir}/ not found${NC}"
    exit 0
fi

echo "Checking flow.mermaid files under ${arch_dir}/..."
echo ""

# 收集所有 {bxx-slug}/flow.mermaid
flows=()
while IFS= read -r -d '' f; do
    flows+=("$f")
done < <(find "$arch_dir" -mindepth 2 -maxdepth 2 -name 'flow.mermaid' -print0 2>/dev/null)

if [ ${#flows[@]} -eq 0 ]; then
    echo -e "${YELLOW}No flow.mermaid found under ${arch_dir}/*/${NC}"
    exit 0
fi

for f in "${flows[@]}"; do
    # label = slug/flow.mermaid（相对 arch_dir 的父两级）
    label="$(basename "$(dirname "$f")")/$(basename "$f")"
    check_with_mmdc "$f" "$label"
done

echo ""
echo -e "=== Result: ${GREEN}PASS=${PASS}${NC} ${RED}FAIL=${FAIL}${NC} ==="

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
