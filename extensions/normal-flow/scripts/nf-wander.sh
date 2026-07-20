#!/usr/bin/env bash
# nf-wander.sh — normal-flow verify 阶段「真实可用契约」自动漫游脚本
#
# 目的：让 verify 阶段不必再"自报 PASS"，必须由真实证据闭环。
#  - 自动识别项目类型（npm / go / python / makefile / docker compose）
#  - 启动服务 → 探测端口 → 写 health-check.txt
#  - 把 curl 命令和响应体存入 evidence/responses/，供 verify-report.md 引用
#  - 生成 wander-report.md 骨架（agent 填实际观察/截图）
#  - 抓 1 条兜底响应（4xx）证明系统会拒绝
#
# 用法（在项目根目录执行）：
#   bash extensions/normal-flow/scripts/nf-wander.sh [BASE_URL]
#
# 环境变量：
#   NF_WANDER_PORT     覆盖自动探测端口（默认 8000）
#   NF_WANDER_HEALTH   覆盖健康检查路径（默认 /healthz）
#   NF_WANDER_HEALTH_FALLBACK /health 或 /healthz，/healthz 优先
#   NF_WANDER_NO_START 设为 1 跳过服务自启（用户已手动起服务）
#   NF_WANDER_KEEP     设为 1 跑完保留服务进程（默认会 kill）
#
# 退出码：0=全部成功；非零=有失败，agent 据此修复并重跑。
#
# 详见 extensions/normal-flow/evidence/verify-gate.ts (HEALTH_CHECK_MISSING /
# FALLBACK_EVIDENCE_MISSING / WANDER_REPORT_MISSING) —— 这三个 gate 直接消费
# 本脚本的产物。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_ROOT"

EVIDENCE_DIR=".xdd/runs/normal_run/evidence"
RESPONSES_DIR="$EVIDENCE_DIR/responses"
HEALTH_CHECK="$EVIDENCE_DIR/health-check.txt"
WANDER_REPORT="$EVIDENCE_DIR/wander-report.md"
mkdir -p "$RESPONSES_DIR"

BASE_URL="${1:-}"
PORT="${NF_WANDER_PORT:-}"
HEALTH_PATH="${NF_WANDER_HEALTH:-}"
HEALTH_FALLBACK="${NF_WANDER_HEALTH_FALLBACK:-/health}"
NO_START="${NF_WANDER_NO_START:-0}"
KEEP="${NF_WANDER_KEEP:-0}"

LOG="$EVIDENCE_DIR/nf-wander.log"
: > "$LOG"

log() { echo "[nf-wander] $*" | tee -a "$LOG" ; }

# ── 1. 探测 base url / 端口 ─────────────────────────────────────────────────
detect_base_url() {
    if [[ -n "$BASE_URL" ]]; then echo "$BASE_URL"; return; fi
    if [[ -n "$PORT" ]]; then echo "http://localhost:$PORT"; return; fi
    # 按优先级找端口候选
    for p in 8000 3000 5000 8080 8888 80; do
        if curl -sf -o /dev/null -m 1 "http://localhost:$p/" 2>/dev/null; then
            echo "http://localhost:$p"; return
        fi
    done
    # 默认仍然返 8000（脚本会启服务到 8000，启完再 retry）
    echo "http://localhost:8000"
}

# ── 2. 启服务（按项目类型）─────────────────────────────────────────────────
SERVER_PID=""
start_server() {
    if [[ "$NO_START" == "1" ]]; then log "跳过自启（NF_WANDER_NO_START=1）"; return; fi
    if curl -sf -o /dev/null -m 1 "$(detect_base_url)/" 2>/dev/null; then
        log "端口已有服务在跑（$(detect_base_url)），跳过自启"
        return
    fi
    if [[ -f "docker-compose.yml" || -f "docker-compose.yaml" ]]; then
        log "检测到 docker compose，尝试 up（无则继续）"
        (docker compose up -d --wait 2>>"$LOG" || true) &
        return
    fi
    if [[ -f "package.json" ]]; then
        # 找 start 脚本
        if grep -q '"start"' package.json; then
            log "npm start (后台)"
            npm start >"$EVIDENCE_DIR/server.log" 2>&1 &
            SERVER_PID=$!
            return
        fi
        # 兜底：python -m http.server（适合纯静态 / 没 build 工具的临时验证）
        log "无 npm start，回退 python -m http.server"
        (python3 -m http.server "${PORT:-8000}" >"$EVIDENCE_DIR/server.log" 2>&1 &) ; SERVER_PID=$!
        return
    fi
    if [[ -f "go.mod" ]]; then
        log "go run . (后台)"
        go run . >"$EVIDENCE_DIR/server.log" 2>&1 &
        SERVER_PID=$!
        return
    fi
    if [[ -f "pyproject.toml" || -f "requirements.txt" ]]; then
        # 兜底：python http.server
        log "Python 项目，回退 python -m http.server"
        (python3 -m http.server "${PORT:-8000}" >"$EVIDENCE_DIR/server.log" 2>&1 &) ; SERVER_PID=$!
        return
    fi
    if [[ -f "Makefile" ]] && grep -qE '^[a-z-]+:.*' Makefile; then
        log "make（取第一个 target）"
        target=$(grep -oE '^[a-z][a-z0-9-]+:' Makefile | head -1 | tr -d ':')
        if [[ -n "$target" ]]; then
            make "$target" >"$EVIDENCE_DIR/server.log" 2>&1 &
            SERVER_PID=$!
            return
        fi
    fi
    log "未识别项目类型，跳过自启——请手动起服务后再跑"
}

stop_server() {
    if [[ "$KEEP" == "1" ]]; then log "保留服务进程（NF_WANDER_KEEP=1）"; return; fi
    if [[ -n "$SERVER_PID" ]]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    # docker compose down 不主动跑（用户可能想保留）；只是提示
}

cleanup() { stop_server; }
trap cleanup EXIT

# ── 3. 等服务就绪 ────────────────────────────────────────────────────────
wait_ready() {
    local url="$1" tries=20
    # 注意：不用 curl -f。 -f 会把 4xx 当作失败，但应用服务器可能对 / 返回 404
    # （根路由未实现 / 只实现 /api/*），这不代表服务未起。只要 TCP 握手成功
    # （不返 000 / connection refused）就算就绪。
    while (( tries > 0 )); do
        local code
        code=$(curl -s -o /dev/null -w "%{http_code}" -m 1 "$url/" 2>/dev/null || echo "000")
        if [[ "$code" != "000" ]]; then return 0; fi
        sleep 0.5
        tries=$((tries-1))
    done
    return 1
}

# ── 4. 抓 health-check ──────────────────────────────────────────────────
probe_health() {
    local base="$1" path="${HEALTH_PATH:-}"
    if [[ -z "$path" ]]; then
        for candidate in /healthz /health /api/health /readyz /ready; do
            if curl -sf -o /dev/null -m 2 "$base$candidate" 2>/dev/null; then path="$candidate"; break; fi
        done
    fi
    if [[ -z "$path" ]]; then path="$HEALTH_FALLBACK"; fi
    local out="$EVIDENCE_DIR/health-raw.txt"
    local code
    code=$(curl -s -L -o "$out" -w "%{http_code}" -m 5 "$base$path" 2>/dev/null || echo "000")
    {
        echo "# health-check (auto-generated by nf-wander.sh)"
        echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "url: $base$path"
        echo "status_code: $code"
        echo "--- response body (first 800 chars) ---"
        head -c 800 "$out" 2>/dev/null
        echo
    } > "$HEALTH_CHECK"
    log "health-check: $base$path → $code → $HEALTH_CHECK"
    if [[ "$code" =~ ^2 ]]; then return 0; fi
    return 1
}

# ── 5. 抓业务端点（heuristic: GET 一次 /，GET 一次 /api/，POST 一次 /） ──
probe_business() {
    local base="$1"
    declare -a hits=()
    for path in / /api/ /api/items /api/v1 /items /health /api/login /api/auth/login; do
        local code
        code=$(curl -s -o "$RESPONSES_DIR/get_$(echo "$path" | tr '/' '_').html" -w "%{http_code}" -m 3 "$base$path" 2>/dev/null || echo "000")
        log "GET $path → $code"
        if [[ "$code" =~ ^[23] ]]; then hits+=("$path:$code"); fi
    done
    # 尝试一次 POST（4xx 也是合法证据，证明路由存在）
    local post_code
    post_code=$(curl -s -X POST -H 'content-type: application/json' -d '{}' -o "$RESPONSES_DIR/post_root.json" -w "%{http_code}" -m 3 "$base/" 2>/dev/null || echo "000")
    log "POST / → $post_code"
    [[ "$post_code" =~ ^4 ]] && hits+=("POST /:$post_code")
    echo "${hits[@]}"
}

# ── 6. 写 wander-report 骨架 ────────────────────────────────────────────
write_wander_skeleton() {
    local base="$1"
    cat > "$WANDER_REPORT" <<EOF
# Wander Report (auto-skeleton by nf-wander.sh)

> 由 nf-wander.sh 生成的骨架。**用 nf_wander 工具 record_step 填实际观察，或直接编辑本文件**。
> 必须引用至少 1 个 Feature Scenario（@AC-XX 或 .feature 文件名），否则 verify gate 仍会拒绝。

- Base URL: $base
- Started At: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Feature Scenario: （待填，例：.xdd/design/spec/b01/auth.feature :: Scenario: 用户登录成功）

## Step 1: 进入入口
- 操作: 浏览器打开 $base/
- 观察: （填实际看到的内容：HTML/重定向/状态码）
- 结果: （PASS / FAIL / BLOCKED）

## Step 2: 核心 Feature 操作
- 操作: （curl 命令或浏览器步骤）
- 观察: （响应体/截图路径）
- 结果: （PASS / FAIL / BLOCKED）

## Step 3: 完成目标 + 兜底
- 操作: （验证目标完成 / 故意制造失败路径）
- 观察: （成功证据或 4xx/5xx 响应）
- 结果: （PASS / FAIL / BLOCKED）

## 最终判断
- Verdict: PASS | PASS_WITH_FRICTION | FAIL | BLOCKED | INCONCLUSIVE
- 理由: ...
- 证据: （引用 responses/*.html 或 screenshots/*.png 路径）
EOF
    log "wander-report 骨架已生成：$WANDER_REPORT"
}

# ── 主流程 ──────────────────────────────────────────────────────────────
log "项目根：$PROJECT_ROOT"
log "evidence 目录：$EVIDENCE_DIR"

start_server
BASE_URL="$(detect_base_url)"
log "base url：$BASE_URL"

if ! wait_ready "$BASE_URL"; then
    log "❌ 服务未就绪（5s 内未响应）。检查：端口 / docker compose / npm start"
    log "   可用 NF_WANDER_NO_START=1 跳过自启并手动起服务，或 NF_WANDER_PORT 改端口"
    exit 2
fi

# health
if ! probe_health "$BASE_URL"; then
    log "⚠️ health 端点非 2xx，但 health-check.txt 已生成（含状态码）"
fi

# business endpoints
hits=$(probe_business "$BASE_URL")
if [[ -z "$hits" ]]; then
    log "❌ 业务端点全部失败，证据写入 $RESPONSES_DIR/"
    exit 3
fi
log "✓ 业务端点响应：$hits"

# wander skeleton
write_wander_skeleton "$BASE_URL"

log "✓ nf-wander 完成。证据：$EVIDENCE_DIR"
log "  → 健康检查：$HEALTH_CHECK"
log "  → 响应体：$RESPONSES_DIR/（verify-report.md 应引用这些路径）"
log "  → 漫游骨架：$WANDER_REPORT（用 nf_wander record_step 填实际观察）"
exit 0