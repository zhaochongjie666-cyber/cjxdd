---
name: xdd-scaffold
alias: xdd·Scaffold
description: |
  xdd 项目脚手架 — Phase 2.5 触发, 搭本地 Docker 开发环境.
  7 步: 目录骨架 → 开发依赖 → 测试框架 → 服务依赖（Docker） → DB 迁移 → Hello API → Smoke Test.
  产出: 可 TDD 的 Docker 环境 + 全链路 Hello API.
  触发: 脚手架、scaffold、初始化、项目骨架、开发环境、项目初始化、TDD 环境。
version: "1.0.0"
---

# xdd·Scaffold — 项目脚手架

## 角色

在 Phase 2 (DESIGN: BDD/ADD/Arch) 之后、Phase 3 (REVIEW) 之前，搭建**AI 能在本地 Docker 环境内进行 TDD 测试**的可运行环境。

**核心目标**：让 AI 写代码前已经有"可 TDD 的本地 Docker 环境 + 通过验证的全链路 Hello API"。

**前置条件**：系统必须已安装 Docker Engine 和 Docker Compose 插件（`docker compose` 命令可用）。所有外部服务依赖一律通过 Docker 启动，不允许本机直接安装 PostgreSQL/Redis/Minio 等。

> **🔗 关联 Skill**：[`xdd-docker-helper`](../xdd-docker-helper/SKILL.md) — 解决中国区 Docker Registry 拉取问题。**Step 4 拉镜像前**必须先调 [`xdd-docker-helper/scripts/probe-registry.sh`](../xdd-docker-helper/scripts/probe-registry.sh) 探测网络;若探测 exit 1 (GFW 阻断),**强制先装 xdd-docker-helper skill 再拉镜像**,不可跳步。详见 Step 3.5。

## 输入

| 来源 | 文件 | 使用方式 |
|------|------|---------|
| Phase 2.5 Architecture | `architecture.md` §6 文件清单 + §7 API 端点清单 | 目录结构 + 技术栈 + Hello API 选型 |
| Phase 2.5 Architecture | `aggregate-landscape.md` | 聚合清单 → 迁移建表的领域模型参考 |
| Phase 2.5 Architecture | `docker-compose.yml` | 生产服务依赖参考 |
| Phase 2.5 Architecture | `docker-compose.test.yml` | 测试基础设施参考 |

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
- [ ] 包管理文件存在且格式合法
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

### Step 3: 测试框架配置

配置测试框架使其能直接运行。

**产出**：
- `pytest.ini` / `vitest.config.ts` / `go test` 基础配置
- `conftest.py` / `setupTests.ts` / test helper
- 一个空测试 `test_env.py`（只通过，证明框架通了）

**检查**：
- [ ] 测试框架已安装
- [ ] 空测试能跑过
- [ ] 测试失败也能检测到

### Step 3.5: Docker Registry 网络可达性探测（GFW 检测）

> **⚠️ 强制条款**: 在中国区/受限网络环境下,直接 `docker pull postgres:16` 会超时或 403。
> **必须**在 Step 4 拉任何镜像前,跑 `xdd-docker-helper/scripts/probe-registry.sh` 探测网络。
> 探测 exit 1 (GFW 阻断) 时,**强制先装 `xdd-docker-helper` skill** 再继续 Step 4。**不允许跳步直接拉镜像**。

```bash
bash skills/xdd-docker-helper/scripts/probe-registry.sh
PROBE_EXIT=$?

case "${PROBE_EXIT}" in
    0) echo "✓ 直连可用" ;;
    1) echo "✗ GFW 阻断, 必须先装 xdd-docker-helper" ;;
    2|3) echo "✗ Docker 未装或完全离线, 阻断" ;;
esac
```

**决策表**:

| 退出码 | 含义 | 处置 |
|--------|------|------|
| 0 | docker.io 直连 OK | 正常进入 Step 4 |
| 1 | GFW 阻断, docker.1ms.run 代理可达 | **强制装 xdd-docker-helper** |
| 2 | Docker 未装 / daemon 未运行 | 阻断, 让用户先装 Docker |
| 3 | 完全无法访问任何 Registry | 阻断, 建议用户检查网络/VPN |

### Step 4: 服务依赖启动（Docker 部署）

使用 Docker 启动开发用的服务依赖（DB、缓存、对象存储等）。**禁止**在本机直接安装 PostgreSQL/Redis/Minio 等服务。

**前置检查**：
- 确认 `docker compose` 命令可用
- 确认 Docker daemon 运行中
- 如不满足，先安装 Docker

**产出**：
- `docker-compose.yml` — 从 `.xdd/L1.5-architecture/BXX-{slug}/` 拷贝到项目根目录
- `docker-compose.test.yml` — 从 `.xdd/L1.5-architecture/BXX-{slug}/` 拷贝到项目根目录
- `docker-compose.dev.yml` — 开发用服务依赖配置
- `.env.example` — 环境变量模板
- 运行中的 Docker 服务实例

**约束**：
- `docker-compose.dev.yml` 只包含**外部依赖服务**，不包含应用代码构建
- 应用代码用本地进程跑，便于 AI 修改代码后快速重跑
- 与生产 / 测试独立，三者不冲突
- 每个服务必须有健康检查配置（`healthcheck`）
- `.env.example` 必须覆盖所有必需环境变量，不含真实密钥
- **日志挂载**：所有服务的日志目录通过 bind mount 映射到项目根目录 `./logs/<service>/`
- **数据持久化**：数据库等有状态服务的数据目录通过 bind mount 映射到项目根目录 `./data/<service>/`

**检查**：
- [ ] `docker compose version` 成功
- [ ] `docker info` 成功
- [ ] `docker compose -f docker-compose.dev.yml up -d` 全部 GREEN
- [ ] 每个服务端口可达
- [ ] 可以用 DB 客户端创建连接

### Step 5: 数据库迁移

创建数据库 schema + seed 基础数据。

**产出一**：migration
- 根据 L1.5 aggregate-landscape.md 的聚合清单创建初始建表语句
- 每个聚合适配一张表（或一组关联表）
- migration 可重复执行（幂等）

**产出二**：seed data
- 至少 1 条种子记录
- seed 可重复执行（幂等）

**检查**：
- [ ] migration 成功执行
- [ ] seed 数据可查询
- [ ] migration 和 seed 可重复执行

### Step 6: Hello API

实现一个最小 CRUD 端点，跑通从代码到数据库的全链路。

**要求**：
- 至少包含创建（POST）和列表（GET）两个操作
- 写入数据到真实 DB
- 查询返回写入的数据
- 错误路径：写入空数据时返回 400

```
POST /api/hello  {"name": "test"} → 201 {id, name, created_at}
GET  /api/hello  → 200 [{id, name, created_at}, ...]
POST /api/hello  {} → 400 {error: "name is required"}
```

**检查**：
- [ ] `curl POST /api/hello` → 201
- [ ] `curl GET /api/hello` → 200 + 包含刚才创建的数据
- [ ] `curl POST /api/hello {}` → 400

### Step 7: Smoke Test

端到端验证整个开发环境。

**测试清单**：

```
1. 测试框架可运行
2. Hello API 全链路
3. 数据库有数据
4. TDD 循环验证 (RED → GREEN → REFACTOR → GREEN 全链路闭合)
```

**检查**：
- [ ] 全部 4 项检查 PASS
- [ ] TDD 循环：RED → GREEN → REFACTOR → GREEN 全链路闭合

## 产出

> **生命周期角色**: `design_baseline` 设计基线 + 项目代码。

| 产出物 | 位置 | 说明 |
|--------|------|------|
| 项目目录 | 项目根目录 | 完整的可开发目录结构 |
| 生产 compose | `docker-compose.yml`（项目根目录） | 从 L1.5 拷贝 |
| 测试 compose | `docker-compose.test.yml`（项目根目录） | 从 L1.5 拷贝 |
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
```

## 约束

- **Step 1-7 必须按顺序执行**，不允许跳步
- **docker-compose.dev.yml 不包含应用代码构建** — 应用用本地进程跑
- **Hello API 必须写入真实 DB** — 不允许 InMemoryRepository 或 mock
- **Smoke Test 必须包含 TDD 循环验证** — 证明 RED→GREEN 可闭环
- **Scaffold 完成前不允许开始 Phase 3 (REVIEW) / Phase 4 (PLAN) / Phase 5 (EXECUTE)**

## Docker 沙箱规范

所有通过 Docker 启动的服务必须遵守以下沙箱规则：

### 文件读写边界
- AI 的所有文件**写入**（代码、配置、测试数据、报告）**只能写入项目根目录**内
- Docker 容器内的日志、数据、配置文件必须通过 bind mount 暴露到项目根目录下
- 禁止 AI 通过 `docker compose exec` 或 `docker cp` 将文件写出到容器内非挂载路径
- 禁止在宿主机的系统目录（`/etc/`、`/var/`、`/usr/`、`/root/`）下创建或修改文件

### 日志规范
- `docker-compose.dev.yml` 中每个服务必须配置日志挂载：`./logs/<service>/:/var/log/<app>/`
- AI 查看日志时，优先读取 `./logs/<service>/` 下的文件

### 数据持久化规范
- 有状态服务（DB、Redis、Minio 等）必须配置数据卷挂载：`./data/<service>/:/var/lib/<app>/data`
- `docker compose down`（不带 `-v`）不会丢失数据
