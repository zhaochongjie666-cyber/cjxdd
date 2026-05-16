# Scaffold 技术栈模板

四种技术栈的脚手架模板。每种包含：目录结构、包管理、测试框架、开发 compose、Hello API、Smoke Test。

## Python (FastAPI + SQLAlchemy + PostgreSQL)

### 目录结构

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                  # FastAPI 入口
│   ├── config.py                # 配置（DB URL 等）
│   ├── domain/                  # DDD 领域层（聚合根、实体、值对象）
│   │   ├── __init__.py
│   │   └── models.py
│   ├── application/             # 应用服务
│   │   ├── __init__.py
│   │   └── services.py
│   ├── infrastructure/          # 基础设施（接口实现）
│   │   ├── __init__.py
│   │   └── database.py          # SQLAlchemy 引擎 + session
│   └── api/                     # FastAPI 路由
│       ├── __init__.py
│       └── routes.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py              # 测试夹具（test DB session）
│   ├── test_env.py              # 环境验证空测试
│   └── test_hello.py            # Hello API TDD 测试
├── migrations/
│   ├── __init__.py
│   └── 001_init.sql             # 初始建表（幂等）
├── pyproject.toml
├── Dockerfile
├── docker-compose.dev.yml
└── .gitignore
```

### 包管理 (pyproject.toml)

```toml
[project]
name = "app"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]",
    "sqlalchemy>=2.0",
    "psycopg2-binary",
    "alembic",
]

[project.optional-dependencies]
dev = [
    "pytest>=8",
    "pytest-asyncio",
    "httpx",
    "ruff",
]
```

### 测试框架配置

**conftest.py** 核心逻辑：
- 异步测试夹具
- 独立 test DB session（每次测试独立事务，测试结束回滚）
- HTTP 客户端（httpx.AsyncClient）

### Hello API

**POST /api/hello** — 创建记录
```
请求: {"name": "test"}
响应: 201 {"id": "uuid", "name": "test", "created_at": "2026-01-01T00:00:00Z"}
```

**GET /api/hello** — 列表 + 筛选
```
请求: GET /api/hello?name=test
响应: 200 [{"id": "...", "name": "test", "created_at": "..."}]
```

**POST /api/hello {}** — 错误路径
```
请求: {}
响应: 400 {"detail": "name is required"}
```

### Smoke Test

```python
# test_hello.py — TDD 循环验证
# 1. RED: 先写测试（Hello API 未实现 → 失败）
# 2. GREEN: 写实现（测试通过）
# 3. REFACTOR: 重构（保持 GREEN）

async def test_create_hello(client):
    resp = await client.post("/api/hello", json={"name": "smoke"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "smoke"
    assert "id" in data

async def test_list_hello(client):
    await client.post("/api/hello", json={"name": "list-test"})
    resp = await client.get("/api/hello")
    assert resp.status_code == 200
    names = [item["name"] for item in resp.json()]
    assert "list-test" in names

async def test_create_hello_empty_name(client):
    resp = await client.post("/api/hello", json={})
    assert resp.status_code == 400
```

### docker-compose.dev.yml

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: app_dev
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app_dev_pwd
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app_dev"]
      interval: 3s
      timeout: 3s
      retries: 5
    volumes:
      - pg_dev_data:/var/lib/postgresql/data

volumes:
  pg_dev_data:
```

---

## TypeScript (Express/NestJS + Prisma + PostgreSQL)

### 目录结构

```
backend/
├── src/
│   ├── index.ts                 # 应用入口
│   ├── config.ts                # 配置
│   ├── domain/                  # 领域模型
│   │   └── models.ts
│   ├── application/             # 应用服务
│   ├── infrastructure/          # 基础设施
│   │   └── database.ts          # Prisma 客户端
│   └── api/                     # 路由
│       └── routes.ts
├── tests/
│   ├── setup.ts                 # 测试装配
│   ├── test_env.ts              # 环境验证空测试
│   └── test_hello.ts            # Hello API TDD 测试
├── prisma/
│   └── schema.prisma            # Prisma schema + migration
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── docker-compose.dev.yml
└── .gitignore
```

### 包管理

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^5",
    "@prisma/client": "^6"
  },
  "devDependencies": {
    "typescript": "^5",
    "tsx": "^4",
    "vitest": "^3",
    "supertest": "^7",
    "eslint": "^9",
    "prettier": "^3"
  }
}
```

### 其他配置（express 路由 + vitest + prisma schema）

模式与 Python 同构。Hello API 端点一致。

---

## Go (Gin/Echo + GORM + PostgreSQL)

### 目录结构

```
backend/
├── cmd/
│   └── server/
│       └── main.go              # 应用入口
├── internal/
│   ├── domain/                  # 领域模型
│   │   └── model.go
│   ├── application/             # 应用服务
│   ├── infrastructure/          # 基础设施
│   │   └── database.go
│   └── api/                     # 路由 + handler
│       └── handler.go
├── tests/
│   ├── test_env_test.go         # 环境验证空测试
│   └── test_hello_test.go       # Hello API TDD 测试
├── migrations/
│   └── 001_init.sql
├── go.mod
├── go.sum
├── Taskfile.yml 或 Makefile
├── docker-compose.dev.yml
└── .gitignore
```

### go.mod

```
module github.com/example/app

go 1.23

require (
    github.com/gin-gonic/gin v1.10
    gorm.io/gorm v1.26
    gorm.io/driver/postgres v1.5
)
```

---

## Java (Spring Boot + JPA + PostgreSQL)

### 目录结构

```
backend/
├── src/
│   ├── main/
│   │   ├── java/com/example/app/
│   │   │   ├── AppApplication.java
│   │   │   ├── domain/
│   │   │   │   └── model/
│   │   │   ├── application/
│   │   │   ├── infrastructure/
│   │   │   └── api/
│   │   │       └── HelloController.java
│   │   └── resources/
│   │       └── application.yml
│   └── test/
│       └── java/com/example/app/
│           ├── AppApplicationTests.java
│           └── api/
│               └── HelloControllerTest.java
├── migrations/
│   └── V1__init.sql
├── pom.xml
├── docker-compose.dev.yml
└── .gitignore
```

---

## 通用约束

所有技术栈的 Hello API 行为一致：

| 端点 | 请求 | 成功响应 | 错误响应 |
|------|------|---------|---------|
| POST /api/hello | `{"name": "text"}` | 201 `{"id", "name", "created_at"}` | 400 缺 name |
| GET /api/hello | `?name=text` (可选) | 200 `[{"id", "name", "created_at"}]` | — |

所有 Smoke Test 验证一致：

```
1. 空测试 GREEN  → pytest/vitest/go test 能跑
2. POST 201     → curl 返回 201
3. GET 200      → curl 返回列表包含刚创建的数据
4. POST 400     → 空 name 返回 400
5. TDD 循环     → RED(无实现) → GREEN(有实现) → 保持 GREEN(重构后)
```
