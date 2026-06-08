#!/bin/bash
# xdd-gate-6-verify.sh — Phase 6 VERIFY 4 维审计 + L6 子阶段 gate

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

is_meta_project && exit 0

xdd_dir=$(get_xdd_dir)
[[ -z "$xdd_dir" ]] && exit 2

iter=$(get_current_iter)
[[ -z "$iter" ]] && { echo "[xdd] (无 current-iteration)"; exit 0; }

# 检查 R11 真实烟雾测试 marker
marker_dir="$xdd_dir/iterations/$iter/L6-deploy"
markers=""
if [[ -d "$marker_dir" ]]; then
    markers=$(find "$marker_dir" -name "smoke-test-passed" 2>/dev/null)
fi

if [[ -z "$markers" ]]; then
    echo "[xdd] ⚠️  Phase 6 VERIFY: 无 L6 smoke-test-passed marker"
    echo "[xdd]    加载 xdd-l6 skill 跑 L6 部署验证 + 写 marker"
fi

# 检查 deployment-report.md
report_dir="$xdd_dir/iterations/$iter/L6-deploy"
if [[ -d "$report_dir" ]]; then
    reports=$(find "$report_dir" -name "deployment-report.md" 2>/dev/null)
    if [[ -n "$reports" ]]; then
        echo "[xdd] ✓ Phase 6 VERIFY: $(echo "$reports" | wc -l) deployment-report.md"
    fi
fi

echo "[xdd] (Phase 6 4 维审计 + L6 chaos 子阶段在 plugin/xdd-gates.ts 段 5.5/5.7 跑)"
exit 0
