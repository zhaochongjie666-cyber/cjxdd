---
name: shadow-scaffold
alias: Shadow·Scaffold
description: |
  Shadow 项目脚手架 — 在 L1.5 之后、L2/L5 之前搭建本地 Docker 开发环境。
  7 步走：目录骨架 → 开发依赖 → 测试框架配置 → 服务依赖启动（Docker） → 数据库迁移 → Hello API → Smoke Test。
  产出可 TDD 的本地 Docker 环境 + 一个通过验证的全链路 Hello API。
  触发：脚手架、scaffold、初始化、项目骨架、开发环境、项目初始化、TDD 环境。
version: "1.0.0"
---

# Shadow·Scaffold — 项目脚手架

## 角色

在 L1.5（架构设计）之后、L2（验收）和 L5 Plan（执行计划）之前，搭建一个**AI 能在本地 Docker 环境内进行 TDD 测试**的可运行环境。

**核心目标**：不是在 L4/L5 才让 AI 猜目录结构、装依赖、配测试框架。在写任何代码之前，先把本地 Docker 开发环境搭好并验证通过。

**前置条件**：系统必须已安装 Docker Engine 和 Docker Compose 插件（`docker compose` 命令可用）。所有外部服务依赖一律通过 Docker 启动，不允许本机直接安装 PostgreSQL/Redis/Minio 等。

## 输入

| 来源 | 文件 | 使用方式 |
|------|------|---------|
| L1.5 Architecture | `architecture.md` §6 文件清单 + §7 API 端点清单 | 目录结构 + 技术栈 + Hello API 选型 |
| L1.5 Architecture | `aggregate-landscape.md` | 聚合清单 → 迁移建表的领域模型参考 |
| L1.5 Architecture | `docker-compose.yml` | 生产服务依赖参考 |
| L1.5 Architecture | `docker-compose.test.yml` | 测试基础设施参考 |

## 7 步流程

每一步必须完成才能进入下一步。不允许跳步。

### Step 1: 目录骨架

从 L1.5 文件清单创建项目目录结构 + 包管理初始化。

**产出**：
- 完整的项目目录树（后端 / 前端 / 迁移 / 测试）
- `package.json` / `pyproject.toml` / `go.mod` / `pom.xml`
- `.gitignore`、`README.md`（初始占位）

**检查**：
- [ ] 目录树完整（后端、测试、迁移都有独立目录）
- [ ] 包管理文件存在且格式合法（`python -m json.tool package.json` 等）
- [ ] `.gitignore` 覆盖了常见模式（node_modules/__pycache__/.env/venv）

### Step 2: 开发依赖

安装测试框架、linter、formatter 等开发工具。

**各技术栈最小依赖**：

| 技术栈 | 测试框架 | Linter | Formatter | 其他 |
|--------|---------|--------|-----------|------|
| Python | pytest + pytest-asyncio + httpx | ruff | ruff | uv, sqlalchemy |
| TypeScript | vitest + @testing-library/react | eslint | prettier | prisma/typeorm |
| Go | testing (go test) | golangci-lint | gofmt | gorm/sqlx |
| Java | JUnit 5 + Mockito | checkstyle | spotless | spring-boot-starter |

**原则**：只装开发必需的最少依赖，不多装。各技术栈详细依赖清单见 `references/tech-stacks.md`。

### Step 3: 测试框架配置

配置测试框架使其能直接运行。

**产出**：
- `pytest.ini` / `vitest.config.ts` / `go test` 基础配置
- `conftest.py` / `setupTests.ts` / test helper
- 一个空测试 `test_env.py`（只通过，证明框架通了）

**检查**：
- [ ] 测试框架已安装（`pytest --version` / `npx vitest --version`）
- [ ] 空测试能跑过（`pytest test_env.py -v` → PASS）
- [ ] 测试失败也能检测到（故意写一个断言失败 → 非零退出码）

### Step 4: 服务依赖启动（Docker 部署）

使用 Docker 启动开发用的服务依赖（DB、缓存、对象存储等）。**禁止**在本机直接安装 PostgreSQL/Redis/Minio 等服务。

**前置检查**：
- 确认 `docker compose` 命令可用（`docker compose version` → 有输出）
- 确认 Docker daemon 运行中（`docker info` → 无报错）
- 如不满足，先安装 Docker

**产出**：
- `docker-compose.yml` — 从 `.shadow/L1.5-architecture/BXX-{slug}/` 拷贝到项目根目录（L6 依赖此文件）
- `docker-compose.test.yml` — 从 `.shadow/L1.5-architecture/BXX-{slug}/` 拷贝到项目根目录（L6 依赖此文件）
- `docker-compose.dev.yml` — 开发用服务依赖配置（从 L1.5 docker-compose.yml 精简得出，仅保留外部依赖服务），使用官方镜像（如 postgres:16、redis:7、minio/minio）
- `.env.example` — 环境变量模板（从 docker-compose.yml 中引用的环境变量提取，含默认值和注释）
- 运行中的 Docker 服务实例

**约束**：
- `docker-compose.dev.yml` 只包含**外部依赖服务**（DB/Redis/Minio），不包含应用代码构建
- 应用代码用本地进程跑（`uvicorn` / `npm run dev` / `go run`），便于 AI 修改代码后快速重跑
- 与 `docker-compose.yml`（生产）和 `docker-compose.test.yml`（测试）独立，三者不冲突
- 每个服务必须有健康检查配置（`healthcheck`）
- `.env.example` 必须覆盖 docker-compose.yml 和应用代码中引用的所有环境变量，不含真实密钥
- 使用官方镜像，指定明确版本标签（如 `postgres:16`）
- **日志挂载**：所有服务的日志目录通过 bind mount 映射到项目根目录 `./logs/<service>/`，如 `./logs/postgres:/var/log/postgresql`，确保 AI 可在项目目录下直接查看日志
- **数据持久化**：数据库等有状态服务的数据目录通过 bind mount 映射到项目根目录 `./data/<service>/`，如 `./data/postgres:/var/lib/postgresql/data`，避免 `docker compose down -v` 丢失开发数据，同时允许 AI 直接检查数据文件
- **文件沙箱**：AI 的所有文件写入（代码、配置、报告）限制在项目根目录（`$PWD`）内；读取允许访问项目目录及 skill 安装目录，禁止读取宿主机系统路径（如 `/etc/`、`/var/` 等）

**检查**：
- [ ] `docker compose version` 成功（Docker 已安装）
- [ ] `docker info` 成功（Docker daemon 运行中）
- [ ] `docker compose -f docker-compose.dev.yml up -d` 全部 GREEN
- [ ] `docker compose -f docker-compose.dev.yml ps` 所有服务状态为 running
- [ ] `docker-compose.yml` 和 `docker-compose.test.yml` 在项目根目录存在
- [ ] `.env.example` 存在且覆盖所有必需环境变量
- [ ] 每个服务端口可达（`nc -zv localhost 5432`）
- [ ] 可以用 DB 客户端创建连接（`psql` / `redis-cli`）
- [ ] 不依赖生产 compose 文件（开发环境独立）

### Step 5: 数据库迁移

创建数据库 schema + seed 基础数据。

**产出一**：migration
- 根据 L1.5 aggregate-landscape.md 的聚合清单创建初始建表语句
- 每个聚合适配一张表（或一组关联表）
- migration 可重复执行（幂等）

**产出二**：seed data
- 至少 1 条种子记录（用于 Hello API 的列表/查询验证）
- seed 可重复执行（幂等）

**检查**：
- [ ] migration 成功执行（表存在）
- [ ] seed 数据可查询（`SELECT * FROM ...` 返回记录）
- [ ] migration 和 seed 可重复执行（幂等）

### Step 6: Hello API

实现一个最小 CRUD 端点，跑通从代码到数据库的全链路。

**要求**：
- 至少包含创建（POST）和列表（GET）两个操作
- 写入数据到真实 DB
- 查询返回写入的数据
- 错误路径：写入空数据时返回 400

**这是 Scaffold 的关键差异** — 不只是搭架子，而是证明架子能跑通。

```
POST /api/hello  {"name": "test"} → 201 {id, name, created_at}
GET  /api/hello  → 200 [{id, name, created_at}, ...]
GET  /api/hello?name=test → 200 支持筛选
POST /api/hello  {} → 400 {error: "name is required"}
```

**检查**：
- [ ] `curl POST /api/hello` → 201
- [ ] `curl GET /api/hello` → 200 + 包含刚才创建的数据
- [ ] `curl POST /api/hello {}` → 400（错误路径）

### Step 7: Smoke Test

端到端验证整个开发环境。

**测试清单**：

```
1. 测试框架可运行
   pytest test_env.py -v → PASS (0 failed)

2. Hello API 全链路
   curl POST /api/hello {"name": "smoke"} → 201
   curl GET /api/hello → 200, 包含 "smoke"

3. 数据库有数据
   查询 seed 数据存在

4. TDD 循环验证
   写一个测试 → 预期 RED（无实现）
   写实现 → 预期 GREEN
   重构 → 保持 GREEN
```

**检查**：
- [ ] 全部 4 项检查 PASS
- [ ] TDD 循环：RED → GREEN → REFACTOR → GREEN 全链路闭合

## 产出

> **生命周期角色**:混合 — `docker-compose.yml` / `docker-compose.test.yml` 从 L1.5 复制,是 `design_baseline` 设计基线(Scaffold 不产出新设计,只搬运);项目根 `docker-compose.dev.yml` / `migrations/` / Hello API / Smoke Test 是项目代码,既是产品交付又是 `design_baseline`;`.env.example` 是 `control_marker` 控制标记(模板)。详见 `shadow-schema.json:lifecycle_artifacts` → `docker-compose` / `docker-compose-test`。

| 产出物 | 位置 | 说明 |
|--------|------|------|
| 项目目录 | 项目根目录 | 完整的可开发目录结构 |
| 生产 compose | `docker-compose.yml`（项目根目录） | 从 L1.5 拷贝，L6 依赖 |
| 测试 compose | `docker-compose.test.yml`（项目根目录） | 从 L1.5 拷贝，L6 依赖 |
| 开发 compose | `docker-compose.dev.yml`（项目根目录） | 开发用服务依赖 |
| 环境变量模板 | `.env.example`（项目根目录） | L6 从此创建 .env |
| migration | `migrations/` 目录 | 可重复执行的建表脚本 |
| Hello API | 后端代码 | 最小 CRUD 端点 |
| Smoke Test | 测试代码 | 环境验证测试 |

## 验证标准

```
ENV_RESULT: VERIFIED / FAIL

判定规则:
  VERIFIED = Step 1-7 全部通过 + Smoke Test 全部 GREEN
  FAIL = 任一 Step 未通过或 Smoke Test 有失败项
  
失败时:
  1. 定位失败的 Step
  2. 补全缺失的产出
  3. 重跑 Smoke Test
  4. 直到 ENV_RESULT == VERIFIED
```

## 约束

- **Step 1-7 必须按顺序执行**，不允许跳步
- **docker-compose.dev.yml 不包含应用代码构建** — 应用用本地进程跑
- **Hello API 必须写入真实 DB** — 不允许 InMemoryRepository 或 mock
- **Smoke Test 必须包含 TDD 循环验证** — 证明 RED→GREEN 可闭环
- **如果环境已存在**（如已有目录结构），检查每一步的产出物存在且可用，缺失或损坏的重做
- **Scaffold 完成前不允许开始 L2/L5 代码工作**

## Docker 沙箱规范

所有通过 Docker 启动的服务必须遵守以下沙箱规则，确保 AI 可在不进入容器的情况下获取调试信息：

### 文件读写边界
- AI 的所有文件**写入**（代码、配置、测试数据、报告）**只能写入项目根目录**内；**读取**允许访问项目目录和 skill 安装目录
- Docker 容器内的日志、数据、配置文件必须通过 bind mount 暴露到项目根目录下
- 禁止 AI 通过 `docker compose exec` 或 `docker cp` 将文件写出到容器内非挂载路径
- 禁止在宿主机的系统目录（`/etc/`、`/var/`、`/usr/`、`/root/`）下创建或修改文件

### 日志规范
- `docker-compose.dev.yml` 中每个服务必须配置日志挂载：`./logs/<service>/:/var/log/<app>/`
- AI 查看日志时，优先读取 `./logs/<service>/` 下的文件，其次用 `docker compose logs`
- 日志文件按天或按大小轮转，避免单个日志文件过大

### 数据持久化规范
- 有状态服务（DB、Redis、Minio 等）必须配置数据卷挂载：`./data/<service>/:/var/lib/<app>/data`
- `docker compose down`（不带 `-v`）不会丢失数据
- AI 可通过 `ls ./data/` 快速确认数据目录是否存在

### 产出物清单

项目根目录下必须新增以下目录：

```
project-root/
  logs/              ← Docker 服务日志（自动生成）
    postgres/
    redis/
  data/              ← Docker 服务数据持久化
    postgres/
    redis/
```
