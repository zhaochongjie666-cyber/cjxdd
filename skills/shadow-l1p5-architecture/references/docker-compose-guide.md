# Docker Compose 生产 + 测试环境详细配置

## 生产环境 compose（docker-compose.yml）

```yaml
version: "3.8"

services:
  # 后端服务
  backend:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ${PROJECT_NAME:-app}-backend
    env_file:
      - .env
    environment:
      - DB_HOST=db
      - REDIS_HOST=redis
    ports:
      - "${BACKEND_PORT:-3002}:3002"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks:
      - app-net
    restart: unless-stopped

  # 前端服务（如有前端）
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: ${PROJECT_NAME:-app}-frontend
    ports:
      - "${FRONTEND_PORT:-80}:80"
    depends_on:
      - backend
    networks:
      - app-net
    restart: unless-stopped

  # 数据库
  db:
    image: postgres:16-alpine
    container_name: ${PROJECT_NAME:-app}-db
    env_file:
      - .env
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-postgres}"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - app-net
    restart: unless-stopped

  # 缓存（如需要）
  redis:
    image: redis:7-alpine
    container_name: ${PROJECT_NAME:-app}-redis
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - app-net
    restart: unless-stopped

volumes:
  pgdata:

networks:
  app-net:
    driver: bridge
```

**设计要点**：
- 每个服务必须有 `healthcheck`（L6 依赖它判断就绪）
- `depends_on` 必须配合 `condition: service_healthy`（不是默认的 started）
- 敏感信息通过 `env_file` 注入，不硬编码
- 服务间通过内部 network 通信，不暴露不必要的端口
- 数据卷持久化（pgdata），容器重建不丢数据
- 命名带 `${PROJECT_NAME}` 前缀，避免多项目冲突
- `restart: unless-stopped` 保证崩溃后自动恢复

## 测试环境 compose（docker-compose.test.yml）

```yaml
version: "3.8"

services:
  # 后端测试
  backend-test:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ${PROJECT_NAME:-app}-backend-test
    env_file:
      - .env.test
    environment:
      - DB_HOST=db-test
      - DB_NAME=${TEST_DB_NAME:-app_test}
      - REDIS_HOST=redis-test
    depends_on:
      db-test:
        condition: service_healthy
      redis-test:
        condition: service_started
    command: ["npm", "run", "test"]
    profiles:
      - test
    networks:
      - test-net

  # 测试数据库
  db-test:
    image: postgres:16-alpine
    container_name: ${PROJECT_NAME:-app}-db-test
    environment:
      POSTGRES_USER: ${TEST_DB_USER:-test}
      POSTGRES_PASSWORD: ${TEST_DB_PASSWORD:-test}
      POSTGRES_DB: ${TEST_DB_NAME:-app_test}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${TEST_DB_USER:-test}"]
      interval: 3s
      timeout: 2s
      retries: 5
    profiles:
      - test
    networks:
      - test-net

  # 测试缓存
  redis-test:
    image: redis:7-alpine
    container_name: ${PROJECT_NAME:-app}-redis-test
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 2s
      retries: 5
    profiles:
      - test
    networks:
      - test-net

  # Playwright E2E（如有前端 — 针对 docker compose 运行中的 dev 服务）
  playwright-e2e:
    image: mcr.microsoft.com/playwright:v1.52.0-jammy
    container_name: ${PROJECT_NAME:-app}-pw-e2e
    working_dir: /e2e
    volumes:
      - ./e2e:/e2e
      - /tmp/playwright-report:/e2e/playwright-report
    environment:
      - BASE_URL=http://frontend:80
      - API_URL=http://backend:3002
    depends_on:
      backend:
        condition: service_healthy
      frontend:
        condition: service_started
    command: ["npx", "playwright", "test", "--reporter=list"]
    profiles:
      - e2e
    networks:
      - test-net

networks:
  test-net:
    driver: bridge
```

**设计要点**：
- 使用 `profiles: [test]` 隔离测试环境，生产启动时自动排除
- 测试数据库使用独立名称（`app_test`），不影响开发数据
- `command` 直接设为测试命令（`npm run test`），一行命令跑完
- `.env.test` 提供测试专用配置（弱密码、短超时、mock 外部服务）
- 测试数据库不挂载持久化卷（每次测试从干净的 schema 开始）

## 运行方式

```bash
# 生产环境启动
docker compose up -d

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f backend

# 后端测试（针对运行中的 dev 服务）
docker compose exec -T backend npm run test:e2e

# 前端 E2E — Playwright（如有前端，针对 dev 服务）
docker compose --profile e2e run --rm playwright-e2e

# 后端单元测试（独立测试容器）
docker compose --profile test up --abort-on-container-exit

# 数据清理
docker compose --profile test down -v
```

## Docker Compose 架构决策要点

| 决策点 | 强制要求 | 说明 |
|--------|---------|------|
| compose 文件 | `docker-compose.yml` + `docker-compose.test.yml` | 生产和测试分离 |
| 健康检查 | 每个服务必配 healthcheck | L6 依赖它判断就绪 |
| 环境变量 | 通过 .env / .env.test 注入 | 不硬编码敏感信息 |
| 网络隔离 | 生产/测试用独立 network | 环境间互不干扰 |
| 数据持久化 | named volume | 容器重建不丢数据 |
| 服务命名 | `${PROJECT_NAME}` 前缀 | 避免多项目端口/卷冲突 |
| 测试 profile | `profiles: [test]` | 生产启动不拉起测试容器 |
| E2E profile | `profiles: [e2e]`（如有前端） | Playwright 容器仅 E2E 时拉起 |
| 依赖等待 | `condition: service_healthy` | 等依赖就绪再启动本服务 |
| 前端 E2E | Playwright CLI（`profiles: [e2e]`） | 针对 docker compose 运行中的 dev 服务测试 |

## 架构文档中的 Docker Compose 产出

架构文档 must 包含：
1. `.shadow/L1.5-architecture/BXX-{slug}/docker-compose.yml` — 生产配置
2. `.shadow/L1.5-architecture/BXX-{slug}/docker-compose.test.yml` — 测试配置
3. 在 architecture.md 的"技术栈"一节中记录 Docker Compose 架构决策（含 @intent）
4. 在 architecture.md 中描述服务拓扑图（服务间依赖关系）

L6 Deploy 直接引用这些 compose 文件执行部署验证，不再自行判断启动方式。
