# Phase 0-3 详细步骤：环境检查 / Compose 配置 / 构建 / 启动+健康检查

> 本文件从 SKILL.md 拆分，包含 Phase 0 到 Phase 3 的完整 bash 命令和诊断细节。

---

## Phase 0: 前置环境验证

在动手之前，先确认执行环境的能力，避免后续误判：

```bash
# 核心工具链 — Docker Compose 是强制要求
which docker           && docker --version        || echo "DOCKER_NOT_FOUND"
which docker compose   && docker compose version  || echo "DOCKER_COMPOSE_NOT_FOUND"
which node            && node --version           || echo "NODE_NOT_FOUND"
which npm             && npm --version            || echo "NPM_NOT_FOUND"  
which curl            && curl --version           || echo "CURL_NOT_FOUND"
which nc              && echo "NC_AVAILABLE"      || echo "NC_NOT_FOUND"

# Playwright（如果包含前端，这是强制工具）
which npx             && npx playwright --version 2>/dev/null || echo "PLAYWRIGHT_NOT_FOUND"
npx playwright install --dry-run 2>/dev/null | head -3 || echo "PLAYWRIGHT_BROWSERS_NOT_CHECKED"

# 端口可用性（从 docker-compose.yml 提取后端+前端端口；如无文件则 fallback 到常见端口）
COMPOSE_FILE="docker-compose.yml"
if [ -f "$COMPOSE_FILE" ]; then
  COMPOSE_PORTS=$(grep -oP '"\d+:\d+"' "$COMPOSE_FILE" | grep -oP '\d+(?=:)' | sort -u | tr '\n' '|' | sed 's/|$//')
  if [ -n "$COMPOSE_PORTS" ]; then
    ss -tlnp | grep -E "($COMPOSE_PORTS)" || echo "PORT_CLEAN"
  else
    echo "COMPOSE_PORTS_EMPTY"
    ss -tlnp | grep -E ":3002|:5173|:8080" || echo "PORT_CLEAN"
  fi
else
  ss -tlnp | grep -E ":3002|:5173|:8080" || echo "PORT_CLEAN"
fi

# Docker Compose 文件检查（强制）
[ -f docker-compose.yml ]       && echo "COMPOSE_PRODUCTION_EXISTS" || echo "COMPOSE_PRODUCTION_MISSING"
[ -f docker-compose.test.yml ]  && echo "COMPOSE_TEST_EXISTS"       || echo "COMPOSE_TEST_MISSING"

# Docker 可用性
docker ps > /dev/null 2>&1 && echo "DOCKER_ACCESSIBLE" || echo "DOCKER_UNREACHABLE"
docker info > /dev/null 2>&1 && echo "DOCKER_INFO_OK" || echo "DOCKER_BROKEN"
```

**Docker compose 是强制启动方式。如果 docker-compose.yml 不存在 = L1.5 架构设计有缺失，记录为架构缺陷后退回。**
**如果包含前端且 Playwright 不可用 = 部署环境不完整，安装后再继续。**

---

## Phase 1: 检查启动配置（Docker Compose 为主）

```bash
# Docker Compose 文件（强制检查）
[ -f docker-compose.yml ]         && echo "COMPOSE_PROD_EXISTS"     || echo "COMPOSE_PROD_MISSING"
[ -f docker-compose.test.yml ]   && echo "COMPOSE_TEST_EXISTS"     || echo "COMPOSE_TEST_MISSING"
[ -f Dockerfile ]                && echo "DOCKERFILE_EXISTS"       || echo "DOCKERFILE_MISSING"

# 环境变量（必须有 .env 或 .env.example）
[ -f .env ]                      && echo "ENV_EXISTS"
[ -f .env.example ]              && echo "ENV_EXAMPLE_EXISTS"
[ -f .env.test ]                 && echo "ENV_TEST_EXISTS"

# 检查 compose 配置合法性
docker compose config --quiet 2>&1 && echo "COMPOSE_CONFIG_VALID"  || echo "COMPOSE_CONFIG_INVALID"
```

如果 docker-compose.yml 缺失 → **记录架构缺陷**：L1.5 架构未按要求产出 Docker Compose 配置，阻塞部署流程。

---

## Phase 2: 构建验证（docker compose build）

```bash
# Docker Compose 构建（主方式）
docker compose build 2>&1 | tail -10
BUILD_EXIT=$?
echo "DOCKER_BUILD_STATUS: $BUILD_EXIT"
[ $BUILD_EXIT -eq 0 ] && echo "BUILD_PASS" || echo "BUILD_FAIL"

# 如果 Docker 构建失败 → 降级诊断：尝试直接 npm 构建以区分是 Docker 问题还是代码问题
if [ $BUILD_EXIT -ne 0 ]; then
  echo "DOCKER_BUILD_FAILED — 降级诊断: 尝试直接构建..."
  npm install 2>&1 | tail -5
  npm run build 2>&1 | tail -20
  NPM_BUILD_EXIT=$?
  [ $NPM_BUILD_EXIT -eq 0 ] && echo "NPM_BUILD_PASS (问题在 Dockerfile)" || echo "NPM_BUILD_FAIL (问题在代码)"
fi
```

**如果构建失败** → 诊断原因：
1. Dockerfile 中的基础镜像是否存在（`docker pull node:20-alpine`）
2. Node 版本兼容性（`node --version` vs Dockerfile FROM）
3. TypeScript 错误明细（`npx tsc --noEmit 2>&1 | head -30`）
4. 依赖安装是否成功（对比 package.json 和 node_modules）

---

## Phase 3: 启动服务 + 多角度健康检查（docker compose 为主）

```bash
# 清理旧容器
docker compose down -v 2>/dev/null || true

# 启动（Docker Compose — 主方式）
docker compose up -d --wait 2>&1
COMPOSE_EXIT=$?
echo "COMPOSE_UP_STATUS: $COMPOSE_EXIT"

if [ $COMPOSE_EXIT -eq 0 ]; then
  # 检查所有服务状态
  docker compose ps
  echo "ALL_SERVICES_STATUS: $(docker compose ps --services --filter status=running | wc -l) running"
  
  # 健康检查 — 逐服务验证
  for svc in $(docker compose ps --services); do
    HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose ps -q $svc)" 2>/dev/null || echo "NO_HEALTHCHECK")
    echo "SERVICE $svc HEALTH: $HEALTH"
  done
  
  # API 健康端点验证
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://127.0.0.1:3002/api/health 2>/dev/null || echo "CURL_FAIL")
  echo "API_HEALTH: HTTP $HTTP_CODE"

else
  echo "COMPOSE_UP_FAILED — 进入诊断模式"
  # 诊断段
  echo "=== COMPOSE LOGS ===" && docker compose logs --tail=50 2>&1
  echo "=== CONTAINER STATUS ===" && docker compose ps
  echo "=== PORT CHECK ===" && ss -tlnp | head -20
  
  # 假设1: 端口冲突
  echo "HYPOTHESIS: PORT_CONFLICT"
  ss -tlnp | grep -E ":3002|:5432|:6379"
  
  # 假设2: Dockerfile 构建失败
  echo "HYPOTHESIS: BUILD_FAILURE"
  docker compose build 2>&1 | tail -20
  
  # 假设3: 服务启动后立即崩溃
  echo "HYPOTHESIS: CRASH_LOOP"
  docker compose run --rm backend npm run dev 2>&1 | head -30 || true
fi
```

**`docker compose up -d --wait` 是主启动方式**。`--wait` 标志会等待所有服务的 healthcheck 通过才返回。如果 healthcheck 配置不完整（L1.5 架构缺陷），此命令不会超时成功。

### 多假设诊断树

**问题：服务无法访问（HTTP连接失败）**

| 假设 | 验证方法 | 证据 |
|------|---------|------|
| 端口不对 | `grep -r "3002\|PORT\|port" package.json vite.config.* 2>/dev/null` | 取出实际端口 |
| 服务启动崩溃 | `npm run dev 2>&1` 前台运行看输出 | 崩溃堆栈 |
| 绑定到了非127.0.0.1 | `ss -tlnp \| grep node` | 实际绑定地址 |
| 启动时间不够 | `for i in 1..30; do curl...; sleep 1; done` | 30秒重试全部失败 |
| 端口被占用 | `ss -tlnp \| grep ":3002 "` | 占用进程PID |
| 防火墙/权限 | `iptables -L \| grep 3002` 或 `nc -zv 127.0.0.1 3002` | 连接拒绝 vs 超时 |

**关键原则**：你不能只试一次就说是"网络问题"。至少试3种以上方式确认确实是网络不可达。
