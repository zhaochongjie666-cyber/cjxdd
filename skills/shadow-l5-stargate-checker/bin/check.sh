#!/usr/bin/env bash
# 实施 A5: stop-gate CLI 入口 — 绕 Meta 旁路, 把硬门禁落 stdout
# 用法:
#   bash skills/shadow-l5-stargate-checker/bin/check.sh [--iter N] <project-root>
#   bash skills/shadow-l5-stargate-checker/bin/check.sh /home/zhaocj/ws/cjxdd/demo/vlademo
#   ITER=iter-3 bash skills/shadow-l5-stargate-checker/bin/check.sh /path/to/project
# 退出码:
#   0 = 5 段 + 5.5 段全 clean
#   1 = 至少 1 段 hard error
#   2 = schema 没装上 / 参数错
#   3 = 写 current-iteration 失败
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# 解析参数 (支持位置参数 + env)
PROJECT_ROOT=""
ITER_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --iter)
      ITER_OVERRIDE="$2"
      shift 2
      ;;
    --iter=*)
      ITER_OVERRIDE="${1#--iter=}"
      shift
      ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      PROJECT_ROOT="$1"
      shift
      ;;
  esac
done
ITER_OVERRIDE="${ITER_OVERRIDE:-${ITER:-}}"
PROJECT_ROOT="${PROJECT_ROOT:-${PROJECT_ROOT_ENV:-$(pwd)}}"

# 默认 schema 路径 (framework 自身 schema)
SCHEMA_PATH="$REPO_ROOT/skills/shadow-init/templates/shadow-schema.json"

# 检查 bun
if ! command -v bun >/dev/null 2>&1; then
  echo "[cli] bun 不在 PATH, 装: curl -fsSL https://bun.sh/install | bash" >&2
  exit 2
fi

# 检查 project root
if [[ ! -d "$PROJECT_ROOT" ]]; then
  echo "[cli] project-root 不存在: $PROJECT_ROOT" >&2
  exit 2
fi

# 检查 shadow dir
SHADOW_DIR="$PROJECT_ROOT/.shadow"
if [[ ! -d "$SHADOW_DIR" ]]; then
  echo "[cli] 没找到 .shadow/ in $PROJECT_ROOT" >&2
  echo "[cli] 先跑 shadow-init: bash $REPO_ROOT/skills/shadow-init/scripts/init.sh" >&2
  exit 2
fi

# 拼 bun 命令
BUN_ARGS=(
  "plugins/shadow-hooks.ts"
  "--run-stop-gate"
  "--project-root" "$PROJECT_ROOT"
  "--schema" "$SCHEMA_PATH"
)
if [[ -n "$ITER_OVERRIDE" ]]; then
  BUN_ARGS+=("--iter" "$ITER_OVERRIDE")
fi

cd "$REPO_ROOT"
exec bun "${BUN_ARGS[@]}"
