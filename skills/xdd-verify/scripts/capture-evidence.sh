#!/usr/bin/env bash
# capture-evidence.sh — verify/polish 截图 + snapshot 证据入口（微软 playwright-cli + 降级）
#
# 用法: capture-evidence.sh <url> <out-png> <out-snapshot> <out-html>
#   <url>           要取证的目标 URL（如 http://localhost:3000/）
#   <out-png>       截图输出（.png，整页）
#   <out-snapshot>  结构化快照输出（playwright-cli snapshot，可访问性树+元素 ref）
#   <out-html>      降级时 HTML 快照输出（.html，curl 抓）
#
# 逻辑:
#   1. playwright-cli 可用（command -v 或 npx playwright-cli）→
#      会话: open → goto <url> → screenshot --filename <png> → snapshot --filename <snap> → close
#      echo "EVIDENCE: png=<png> snapshot=<snap>"
#   2. 不可用/失败 → curl 存 HTML 快照，echo "DEGRADED: 无 playwright-cli，存 HTML 快照 <html>"
#
# 用微软官方 playwright-cli（独立 CLI，含 screenshot/snapshot 命令）：
#   安装: npm install -g @playwright/cli@latest  （install.sh 不装，保持平台中立）
#
# 平台中立惯例（复用 chaos-runner.sh 降级风格）：playwright-cli 是重依赖，
# 缺失不阻塞 verify/polish，降级到 HTML 快照。
#
# 退出码: 0 = 拿到某种证据；1 = 完全失败（url 不可达）；2 = 参数错

set -uo pipefail

URL="${1:-}"
OUT_PNG="${2:-}"
OUT_SNAP="${3:-}"
OUT_HTML="${4:-}"

if [[ -z "$URL" || -z "$OUT_PNG" || -z "$OUT_SNAP" || -z "$OUT_HTML" ]]; then
  echo "用法: capture-evidence.sh <url> <out-png> <out-snapshot> <out-html>" >&2
  exit 2
fi

mkdir -p "$(dirname "$OUT_PNG")" "$(dirname "$OUT_SNAP")" "$(dirname "$OUT_HTML")"

# === 检测 playwright-cli ===
# 优先全局装的 playwright-cli，次用 npx（首次会触发下载，较慢）
CLI=""
if command -v playwright-cli >/dev/null 2>&1; then
  CLI="playwright-cli"
elif command -v npx >/dev/null 2>&1 && npx --no-install playwright-cli --help >/dev/null 2>&1; then
  CLI="npx playwright-cli"
fi

if [[ -n "$CLI" ]]; then
  # 微软 playwright-cli 是会话式：open 建 session（-s），后续命令带同一 session
  # 串: open <url> → screenshot --filename --full-page → snapshot --filename → close
  # 任一步失败则降级
  SESS="xdd-ev-$"
  ok=1
  "$CLI" -s="$SESS" open "$URL" >/dev/null 2>&1 || ok=0
  [[ "$ok" -eq 1 ]] && { "$CLI" -s="$SESS" screenshot --filename "$OUT_PNG" --full-page >/dev/null 2>&1 || ok=0; }
  [[ "$ok" -eq 1 ]] && { "$CLI" -s="$SESS" snapshot --filename "$OUT_SNAP" >/dev/null 2>&1 || ok=0; }
  "$CLI" -s="$SESS" close >/dev/null 2>&1 || true   # 无论成败都关
  if [[ "$ok" -eq 1 && -s "$OUT_PNG" ]]; then
    echo "EVIDENCE: png=$OUT_PNG snapshot=$OUT_SNAP"
    exit 0
  fi
  echo "  ⚠️ playwright-cli 检测到但会话失败，降级到 HTML 快照" >&2
fi

# === 降级: curl 存 HTML 快照 ===
if curl -s -L -m 10 -o "$OUT_HTML" "$URL" 2>/dev/null && [[ -s "$OUT_HTML" ]]; then
  echo "DEGRADED: 无 playwright-cli，存 HTML 快照 $OUT_HTML"
  exit 0
fi

echo "  ❌ 完全失败: $URL 不可达（无截图无快照）" >&2
exit 1
