#!/usr/bin/env bash
# probe-registry.sh — Docker Registry 网络可达性探测
# 翻译自 docker-helper SKILL.md § 1 "环境检测" 思路, 封装成可被 scaffold
# 调用的脚本 (返回 exit code 触发强制流程).
#
# 用法:
#   bash skills/docker-helper/scripts/probe-registry.sh
#   echo $?   # 0 = docker.io 直连 OK, 1 = GFW 阻断, 2 = docker 未安装
#
# 退出码:
#   0 — docker.io / registry-1.docker.io 直连 OK, 可走 daemon.json 镜像源
#   1 — docker.io 直连失败, 但 docker.1ms.run 代理可达 (GFW 区域, 走代理前缀)
#   2 — docker 未安装 / docker daemon 未运行
#   3 — 完全无法访问任何 Docker Registry (用户需配 VPN 或换网络)
#
# scaffold Step 4 调用规则:
#   exit 0 → 正常 docker pull
#   exit 1 → 必须先装 docker-helper, 走 docker.1ms.run 代理前缀
#   exit 2/3 → 阻断, 让用户先解决 Docker 安装/网络问题

set -euo pipefail

PROBE_TIMEOUT="${PROBE_TIMEOUT:-5}"   # 每个探测点 5s 超时
DIRECT_REGISTRY="https://registry-1.docker.io/v2/"
PROXY_REGISTRY="https://docker.1ms.run/v2/"

# ───────── 颜色 / 输出 ─────────
if [[ -t 1 ]]; then
    RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; BOLD=$'\e[1m'; NC=$'\e[0m'
else
    RED=""; GREEN=""; YELLOW=""; BOLD=""; NC=""
fi

log() { echo "[probe] $*"; }
ok()  { echo "${GREEN}✓${NC} $*"; }
warn(){ echo "${YELLOW}⚠${NC}  $*"; }
err() { echo "${RED}✗${NC}  $*"; }

# ───────── 1. Docker 安装检查 ─────────
if ! command -v docker >/dev/null 2>&1; then
    err "docker 命令未找到 (exit=2)"
    err "请先安装 Docker Engine + docker compose 插件"
    echo "  https://docs.docker.com/engine/install/"
    exit 2
fi

if ! docker info >/dev/null 2>&1; then
    err "docker daemon 未运行 (exit=2)"
    err "请先启动 Docker: sudo systemctl start docker"
    exit 2
fi

# ───────── 2. 直连 Docker Hub 探测 ─────────
log "探测 docker.io 直连 (timeout=${PROBE_TIMEOUT}s)..."
DIRECT_OK=0
# registry-1.docker.io 是 Docker Hub 真正的 registry endpoint, 比 index.docker.io 准确
HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
    -m "${PROBE_TIMEOUT}" \
    --connect-timeout "${PROBE_TIMEOUT}" \
    "${DIRECT_REGISTRY}" 2>/dev/null || echo "000")
# Docker Hub v2 endpoint 期望 401/200 (需认证是正常的), 000/403/503 算不可达
case "${HTTP_CODE}" in
    200|401)
        ok "docker.io 直连 OK (HTTP ${HTTP_CODE})"
        DIRECT_OK=1
        ;;
    000)
        # 000 = 连接超时/被墙/无网络
        if curl -sS -o /dev/null -m 3 -w "%{http_code}" https://www.google.com 2>/dev/null | grep -qE "^(200|301|302)$"; then
            err "外网通但 docker.io 被阻断 (HTTP 000) — GFW 区域"
        else
            err "外网也不通 — 完全离线或断网 (HTTP 000)"
        fi
        ;;
    *)
        err "docker.io 异常 (HTTP ${HTTP_CODE})"
        ;;
esac

# ───────── 3. 代理前缀探测 (docker.1ms.run) ─────────
log "探测代理 docker.1ms.run (timeout=${PROBE_TIMEOUT}s)..."
PROXY_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" \
    -m "${PROBE_TIMEOUT}" \
    --connect-timeout "${PROBE_TIMEOUT}" \
    "${PROXY_REGISTRY}" 2>/dev/null || echo "000")
PROXY_OK=0
case "${PROXY_HTTP}" in
    200|401)
        ok "docker.1ms.run 代理 OK (HTTP ${PROXY_HTTP})"
        PROXY_OK=1
        ;;
    *)
        warn "docker.1ms.run 不可达 (HTTP ${PROXY_HTTP})"
        ;;
esac

# ───────── 4. 决策表 ─────────
echo ""
echo "${BOLD}=== 探测结果 ===${NC}"
if [[ ${DIRECT_OK} -eq 1 ]]; then
    echo "  docker.io 直连:    ${GREEN}OK${NC}"
else
    echo "  docker.io 直连:    ${RED}FAIL${NC}"
fi
if [[ ${PROXY_OK} -eq 1 ]]; then
    echo "  docker.1ms.run 代理: ${GREEN}OK${NC}"
else
    echo "  docker.1ms.run 代理: ${RED}FAIL${NC}"
fi
echo ""

if [[ ${DIRECT_OK} -eq 1 ]]; then
    ok "决策: 走 daemon.json 镜像源直接 docker pull (exit=0)"
    exit 0
fi

if [[ ${PROXY_OK} -eq 1 ]]; then
    err "决策: docker.io 被阻断, docker.1ms.run 代理可达 (exit=1)"
    err "→ 装 docker-helper skill, 走代理前缀: docker pull docker.1ms.run/library/<image>"
    err "→ scaffold 必须在拉镜像前检测此退出码并自动装 docker-helper"
    exit 1
fi

# 两个都失败
err "决策: 内外网都通不了 Docker Registry (exit=3)"
err "→ 建议: 配置 VPN / 检查防火墙 / 换网络 / 联系 IT"
exit 3
