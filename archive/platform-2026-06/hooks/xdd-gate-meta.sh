#!/bin/bash
# xdd-gate-meta.sh — Meta 任务守卫 (P0-7)
# 当 CWD 是 xdd framework 仓库自身 (cjxdd) 时, 屏蔽所有意图引导
# "build me X" / "做一个 XX 系统" → xdd-walker 加载. 原因:
#   - 用 xdd 改 xdd 会自指递归 (工件污染 + 状态错乱)
#   - 用户在 framework 仓库里通常是想直接改源码, 不是启动产品项目 pipeline
#
# 判定: 项目根同时存在 agents/xdd-walker.md + skills/xdd-init/SKILL.md +
#       hooks/xdd-gate-lib.sh → framework 自身
#
# 用法: 在其他 hook (session-start / user-prompt-submit / pre-skill / 等) 里
#   source "$(dirname "$0")/xdd-gate-lib.sh"
#   if is_meta_project; then
#       echo "[xdd] ⚠️ Meta 任务, 跳过意图引导"
#       exit 0
#   fi
#
# 单独执行: bash hooks/xdd-gate-meta.sh
# 返回: 0 = 是 Meta 任务, 1 = 不是 Meta 任务, 2 = 没有 xdd 项目

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=xdd-gate-lib.sh
source "$SCRIPT_DIR/xdd-gate-lib.sh"
load_xdd_schema 2>/dev/null || true

if is_meta_project; then
    echo "[xdd] ⚠️  Meta 任务 — CWD 是 cjxdd 仓库自身 (framework 自身)"
    echo "[xdd]    判定: agents/xdd-walker.md + skills/xdd-init/SKILL.md + hooks/xdd-gate-lib.sh 均存在"
    echo "[xdd]    处置: 跳过 walker 加载引导. 用户应直接 Read/Edit 改 framework 源码."
    echo "[xdd]    详见 CLAUDE.md § ⚠️ Meta: 你正在修改 xdd 自身, 禁用 xdd 流程"
    exit 0
else
    root=$(find_project_root) || true
    if [[ -z "$root" ]]; then
        echo "[xdd] 无 .xdd/ 项目 (非 Meta, 也不是 xdd 项目)"
        exit 2
    fi
    echo "[xdd] 非 Meta — 项目根 $root 是普通 xdd 产品项目 (或非 xdd 仓库)"
    exit 1
fi
