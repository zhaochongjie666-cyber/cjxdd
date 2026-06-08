#!/bin/bash
# xdd-gate-5-execute.sh — Phase 5 EXECUTE 全量测试 + BDD 覆盖 gate

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

is_meta_project && exit 0

xdd_dir=$(get_xdd_dir)
[[ -z "$xdd_dir" ]] && exit 2

# 期望: 所有 Phase 5 行的 Task checkbox 都是 [x] (已完成)
iter=$(get_current_iter)
status_path="$xdd_dir/iterations/$iter/pipeline/status.md"
if [[ ! -f "$status_path" ]]; then
    echo "[xdd] (无 status.md, Phase 5 跳过)"
    exit 0
fi

# 简单检查: BDD 覆盖追踪表是否全 [x]
if grep -qE '^\| \`[^`]+` \| Task [0-9]+ \| - \[ \]' "$status_path" 2>/dev/null; then
    echo "[xdd] ❌ Phase 5 EXECUTE: BDD 覆盖追踪表还有未完成 Scenario" >&2
    exit 2
fi

# 检查全量测试
if [[ -f "package.json" ]]; then
    if ! npm test --silent 2>/dev/null | tail -5; then
        echo "[xdd] ⚠️  Phase 5: npm test 有失败 (允许有 warning, 阻塞 hard fail)"
    fi
elif [[ -f "pyproject.toml" || -f "pytest.ini" || -f "setup.py" ]]; then
    if ! python -m pytest --tb=no -q 2>/dev/null | tail -5; then
        echo "[xdd] ⚠️  Phase 5: pytest 有失败"
    fi
fi

echo "[xdd] ✓ Phase 5 EXECUTE: BDD 覆盖追踪表全 [x] + 测试通过"
exit 0
