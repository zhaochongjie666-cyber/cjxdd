#!/usr/bin/env bash
set -euo pipefail

REGISTRY_PROXY="${DOCKER_PROXY:-docker.1ms.run}"
PRIVATE_REGISTRY="${DOCKER_PRIVATE_REGISTRY:-}"
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

# 显式参数只处理项目真正需要的镜像，避免为了“预热”下载整张默认清单。
if [ "$#" -gt 0 ]; then
    IMAGES=("$@")
fi

registry_image() {
    local registry="${1%/}"
    local image="$2"
    # Docker Hub 官方镜像在私有 Hub/代理中通常位于 library 命名空间；已有命名空间保持不变。
    if [[ "${image%%:*}" == */* ]]; then
        printf '%s/%s\n' "${registry}" "${image}"
    else
        printf '%s/library/%s\n' "${registry}" "${image}"
    fi
}

pull_from_registry() {
    local label="$1"
    local registry="$2"
    local image="$3"
    local source_image
    source_image="$(registry_image "${registry}" "${image}")"

    echo ">>> 尝试${label}拉取: ${source_image}"
    local pull_log
    pull_log="$(mktemp)"
    if timeout "${PULL_TIMEOUT}" docker pull "${source_image}" 2>&1 | tee "${pull_log}"; then
        rm -f "${pull_log}"
        docker tag "${source_image}" "${image}"
        echo "    OK (${label}, tagged as ${image})"
        return 0
    fi
    if grep -Eqi 'unauthorized|authentication required|denied: requested access|no basic auth credentials' "${pull_log}"; then
        rm -f "${pull_log}"
        echo "    FAIL: ${label}认证失败；请先执行 docker login ${registry}" >&2
        return 2
    fi
    rm -f "${pull_log}"
    return 1
}

pull_with_proxy() {
    local image="$1"
    pull_from_registry "代理" "${REGISTRY_PROXY}" "${image}"
}

pull_direct() {
    local image="$1"

    echo ">>> 尝试直接拉取: ${image}"
    if timeout "${PULL_TIMEOUT}" docker pull "${image}"; then
        echo "    OK (direct)"
        return 0
    fi
    return 1
}

main() {
    echo "=== Docker 镜像批量拉取 ==="
    echo "私有 Hub: ${PRIVATE_REGISTRY:-未配置}"
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
            ((skipped+=1))
            continue
        fi

        local private_status=1
        if [ -n "${PRIVATE_REGISTRY}" ]; then
            if pull_from_registry "私有 Hub" "${PRIVATE_REGISTRY}" "${image}"; then
                private_status=0
            else
                private_status=$?
            fi
            if [ "${private_status}" -eq 2 ]; then
                echo "停止回退：修复私有 Hub 认证后重试，避免静默使用非预期来源。" >&2
                return 1
            fi
        fi

        if [ "${private_status}" -eq 0 ]; then
            ((ok+=1))
        elif pull_direct "${image}"; then
            ((ok+=1))
        elif pull_with_proxy "${image}"; then
            ((ok+=1))
        else
            echo "    FAIL: ${image}"
            ((fail+=1))
        fi
    done

    echo ""
    echo "=== 完成 ==="
    echo "成功: ${ok} | 失败: ${fail} | 跳过: ${skipped}"

    if [ "${fail}" -gt 0 ]; then
        echo ""
        echo "失败的镜像可手动重试："
        if [ -n "${PRIVATE_REGISTRY}" ]; then
            echo "  docker login ${PRIVATE_REGISTRY}"
            echo "  DOCKER_PRIVATE_REGISTRY=${PRIVATE_REGISTRY} $0 <镜像名>"
        fi
        echo "  docker pull <镜像名>"
        echo "  docker pull ${REGISTRY_PROXY}/library/<镜像名>"
        return 1
    fi
}

main "$@"
