#!/bin/bash
# xdd-gate-0-init.sh — Phase 0 INIT 出口 gate
# 检测 .xdd/ 存在性 + 引导 xdd-init (如缺)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"

# Meta 旁路
is_meta_project && exit 0

shadow=$(get_xdd_dir)
if [[ -z "$shadow" ]]; then
    echo "[xdd] ⚠️  Phase 0 INIT: 项目无 .xdd/ 目录"
    echo "[xdd]    建议: 跑 xdd-init skill 生成骨架"
    echo "[xdd]      bash ~/.claude/skills/xdd-init/scripts/init.sh"
    echo "[xdd]    或从仓库根: ./skills/xdd-init/scripts/init.sh"
    exit 1
fi

# 校验 scale.md 字段
scale_md="$shadow/scale.md"
if [[ ! -f "$scale_md" ]]; then
    echo "[xdd] ⚠️  Phase 0: scale.md 缺失"
    echo "[xdd]    期望: .xdd/scale.md (含 strict_mode 字段)"
    exit 1
fi

if ! grep -q "strict_mode" "$scale_md" 2>/dev/null; then
    echo "[xdd] ⚠️  Phase 0: scale.md 缺 strict_mode 字段"
    echo "[xdd]    期望 strict_mode: true (默认, 用户偏好)"
    exit 1
fi

echo "[xdd] ✓ Phase 0 INIT: .xdd/ 存在 + scale.md 含 strict_mode 字段"
exit 0
