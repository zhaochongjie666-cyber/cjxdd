#!/usr/bin/env bash
set -euo pipefail

REGISTRY_PROXY="${DOCKER_PROXY:-docker.1ms.run}"
PULL_TIMEOUT="${DOCKER_PULL_TIMEOUT:-120}"

IMAGES=(
    "postgres:16-alpine"
    "redis:7-alpine"
    "nginx:alpine"
    "golang:1.23-alpine"
    "node:22-alpine"
    "python:3.12-slim"
    "mysql:8.0"
    "rabbitmq:3.12-management"
    "ubuntu:24.04"
    "alpine:3.19"
)

pull_with_proxy() {
    local image="$1"
    local proxy_image="${REGISTRY_PROXY}/library/${image}"

    echo ">>> 尝试代理拉取: ${proxy_image}"
    if timeout "${PULL_TIMEOUT}" docker pull "${proxy_image}" 2>/dev/null; then
        docker tag "${proxy_image}" "${image}" 2>/dev/null || true
        echo "    OK (via proxy, tagged as ${image})"
        return 0
    fi
    return 1
}

pull_direct() {
    local image="$1"

    echo ">>> 尝试直接拉取: ${image}"
    if timeout "${PULL_TIMEOUT}" docker pull "${image}" 2>/dev/null; then
        echo "    OK (direct)"
        return 0
    fi
    return 1
}

main() {
    echo "=== Docker 镜像批量拉取 ==="
    echo "代理: ${REGISTRY_PROXY}"
    echo "超时: ${PULL_TIMEOUT}s/镜像"
    echo "镜像数: ${#IMAGES[@]}"
    echo "---"

    local ok=0
    local fail=0
    local skipped=0

    for image in "${IMAGES[@]}"; do
        echo ""
        if docker image inspect "${image}" &>/dev/null; then
            echo ">>> 跳过 (已存在): ${image}"
            ((skipped++))
            continue
        fi

        if pull_direct "${image}"; then
            ((ok++))
        elif pull_with_proxy "${image}"; then
            ((ok++))
        else
            echo "    FAIL: ${image}"
            ((fail++))
        fi
    done

    echo ""
    echo "=== 完成 ==="
    echo "成功: ${ok} | 失败: ${fail} | 跳过: ${skipped}"

    if [ "${fail}" -gt 0 ]; then
        echo ""
        echo "失败的镜像可手动重试："
        echo "  docker pull <镜像名>"
        echo "  docker pull ${REGISTRY_PROXY}/library/<镜像名>"
        return 1
    fi
}

main "$@"
