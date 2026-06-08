#!/usr/bin/env bash
set -euo pipefail

MMDC="${MMDC:-$(which mmdc 2>/dev/null || echo '')}"
SHADOW_DIR="${1:-${SHADOW_DIR:-.shadow}}"

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
    local slug="$(basename "$file")"
    local tmpout="$(mktemp /tmp/_mmdc_XXXXXX.svg)"

    if "$MMDC" -i "$file" -o "$tmpout" -q 2>&1; then
        echo -e "  ${GREEN}PASS${NC} mmdc: '${slug}' renders OK"
        ((PASS++)) || true
    else
        echo -e "  ${RED}FAIL${NC} mmdc: '${slug}' has parse errors"
        ((FAIL++)) || true
    fi
    rm -f "$tmpout"
}

echo "=== Mermaid Render Validation (mmdc) ==="
echo ""

l1_dir="${SHADOW_DIR}/business"
if [ ! -d "$l1_dir" ]; then
    echo -e "${YELLOW}${l1_dir}/ not found${NC}"
    exit 0
fi

flows=()
if [ -f "$l1_dir/project.flow.mermaid" ]; then
    flows+=("$l1_dir/project.flow.mermaid")
elif [ -f "$l1_dir/flow.mermaid" ]; then
    echo -e "${YELLOW}Deprecated: using legacy flow.mermaid; rename to project.flow.mermaid${NC}"
    flows+=("$l1_dir/flow.mermaid")
fi

if [ ${#flows[@]} -eq 0 ]; then
    echo -e "${YELLOW}No project-level project.flow.mermaid found${NC}"
    exit 0
fi

echo "Checking project-level project.flow.mermaid..."
echo ""

for f in "${flows[@]}"; do
    check_with_mmdc "$f"
done

echo ""
echo -e "=== Result: ${GREEN}PASS=${PASS}${NC} ${RED}FAIL=${FAIL}${NC} ==="

[ $FAIL -eq 0 ] && exit 0 || exit 1
