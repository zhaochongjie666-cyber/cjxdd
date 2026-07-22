# 前后端项目环境配置方法

## 正向开发入口

先读项目的包管理锁文件、前后端启动/构建命令、后端端口、健康检查和 API 前缀，再在**项目根目录**产出 `prodapp.sh`、`devapp.sh`、生产/开发 Compose、Dockerfile 与 Nginx 配置。不要写入项目的 `.pi/`。

开始前必须执行：

```bash
docker images --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}'
docker info --format '{{json .RegistryConfig}}'
```

按“本地已有镜像 → 已登录的私有 Hub → Docker Hub 直连 → 可用代理”选镜像。优先使用用户提供的 `DOCKER_PRIVATE_REGISTRY`；未提供私有 Hub 地址或凭据时不得猜地址、不得把密码写入文件，而应保留变量并给出 `docker login "$DOCKER_PRIVATE_REGISTRY"` 的明确动作。

## 生产环境

`prodapp.sh` 必须用 `docker compose -f compose.prod.yml up -d --build --wait` 启动。生产构建应满足：

- 前端采用多阶段 Dockerfile：Node 阶段按锁文件执行可复现安装并构建，最终只把静态产物复制进 Nginx；运行容器不携带源码或 `node_modules`。
- Nginx 托管 SPA，未知前端路由回退到 `index.html`；`/api/` 反向代理到 Compose 内的后端服务名，传递 Host、X-Forwarded-For 与 X-Forwarded-Proto。
- 后端镜像只包含运行时依赖，服务设有真实 healthcheck；Nginx 在后端 healthy 后启动。
- 镜像引用允许 `${DOCKER_PRIVATE_REGISTRY:-...}` / `${IMAGE_PREFIX:-...}` 覆盖，锁定明确版本，不使用隐式 `latest`。

## 开发环境

`devapp.sh` 必须用 `docker compose -f compose.dev.yml up --build` 启动。开发配置应满足：

- 前后端项目目录通过 bind mount 挂载，以热重载命令启动，并监听 `0.0.0.0`；宿主端口可由环境变量覆盖。
- Vite 使用 `--host 0.0.0.0`（或等价框架配置），dev server 的 `/api` proxy 指向 Compose 后端服务名，不能写 `localhost`。
- 依赖目录使用**命名卷**（例如 `frontend_node_modules`、`backend_venv`/语言缓存卷），镜像构建时先按 lockfile 安装依赖。bind mount 不覆盖依赖卷，因此重启不重复复制或安装。
- BuildKit cache mount 缓存 npm/pnpm/yarn/pip/go 等下载缓存；只有 lockfile 变化才使依赖安装层失效。`devapp.sh` 不执行 `npm install`/`pip install`。
- 文件监听在容器/宿主组合不支持原生事件时，可通过显式环境变量开启 polling；默认不要强制高频轮询。

## 脚本最低行为

两个脚本都应 `set -euo pipefail`、检查 Docker/Compose、校验必需环境变量、透传额外 Compose 参数并给出可执行错误动作。私有 Hub 启用时，先验证 `docker login` 状态或拉取一个所需镜像；认证失败立即停止，不能静默改用来源不明的镜像。

## 攻击检查与回炉

正向检查：生产构建后用浏览器/curl 访问 SPA 和 `/api/healthz`；开发环境修改前后端文件，证明无需重建即可热更新。

兜底攻击：

1. 停掉后端，确认 Nginx 返回明确的 502/降级响应且不把请求错误路由到 SPA。
2. 使用错误的私有 Hub 凭据，确认脚本在拉取前失败并提示 `docker login` 修复动作。
3. 连续执行两次 `devapp.sh`，比较构建日志和命名卷，确认第二次没有重新下载/安装依赖。
4. 从外部主机访问映射端口，确认监听地址不是 `127.0.0.1`；同时确认数据库等内部端口未意外公开。
5. 修改 lockfile，确认依赖层会重新安装；不改 lockfile 时确认缓存命中。

攻击失败必须回到 Dockerfile/Compose/Nginx/脚本对应层修复并重跑，不得以“环境限制”代替闭环证据。
