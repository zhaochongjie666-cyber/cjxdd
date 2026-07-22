#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

cat >"${TMP}/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >>"${DOCKER_TEST_LOG}"
case "$1" in
  image) exit "${LOCAL_IMAGE_EXIT:-1}" ;;
  pull)
    if [[ "$2" == "registry.internal.example/"* ]]; then
      if [[ "${PRIVATE_PULL_AUTH_FAIL:-0}" == 1 ]]; then echo 'unauthorized: authentication required' >&2; exit 1; fi
      exit "${PRIVATE_PULL_EXIT:-0}"
    fi
    exit 0
    ;;
  tag) exit 0 ;;
esac
EOF
chmod +x "${TMP}/docker"

export PATH="${TMP}:${PATH}"
export DOCKER_TEST_LOG="${TMP}/docker.log"

DOCKER_PRIVATE_REGISTRY=registry.internal.example \
    bash "${ROOT}/pull-common-images.sh" nginx:alpine >/dev/null
grep -Fx 'docker pull registry.internal.example/library/nginx:alpine' "${DOCKER_TEST_LOG}"
grep -Fx 'docker tag registry.internal.example/library/nginx:alpine nginx:alpine' "${DOCKER_TEST_LOG}"
if grep -Fxq 'docker pull nginx:alpine' "${DOCKER_TEST_LOG}"; then
    echo '私有 Hub 成功后不应回退到 Docker Hub' >&2
    exit 1
fi

: >"${DOCKER_TEST_LOG}"
PRIVATE_PULL_EXIT=1 DOCKER_PRIVATE_REGISTRY=registry.internal.example \
    bash "${ROOT}/pull-common-images.sh" redis:7-alpine >/dev/null
grep -Fx 'docker pull registry.internal.example/library/redis:7-alpine' "${DOCKER_TEST_LOG}"
grep -Fx 'docker pull redis:7-alpine' "${DOCKER_TEST_LOG}"

: >"${DOCKER_TEST_LOG}"
LOCAL_IMAGE_EXIT=0 DOCKER_PRIVATE_REGISTRY=registry.internal.example \
    bash "${ROOT}/pull-common-images.sh" node:22-alpine >/dev/null
if grep -q 'docker pull' "${DOCKER_TEST_LOG}"; then
    echo '本地已有镜像时不应拉取' >&2
    exit 1
fi

: >"${DOCKER_TEST_LOG}"
if PRIVATE_PULL_AUTH_FAIL=1 DOCKER_PRIVATE_REGISTRY=registry.internal.example \
    bash "${ROOT}/pull-common-images.sh" postgres:16-alpine >"${TMP}/auth.out" 2>&1; then
    echo '私有 Hub 认证失败时脚本应失败' >&2
    exit 1
fi
grep -F 'docker login registry.internal.example' "${TMP}/auth.out"
if grep -Fxq 'docker pull postgres:16-alpine' "${DOCKER_TEST_LOG}"; then
    echo '私有 Hub 认证失败时不应静默回退' >&2
    exit 1
fi

echo 'pull-common-images tests: PASS'
