---
name: docker-helper
description: >
  Docker 中国区助手 — 解决中国境内的 Docker Registry 访问问题。
  配置中国镜像源（阿里云、腾讯云、中科大、网易云等），通过镜像代理拉取 Docker Hub 镜像，
  基于 Ubuntu 官方镜像构建带中国 apt 源的 Dockerfile，提供常用基础镜像的快速拉取方案。
  当用户提到 "Docker 镜像"、"拉取镜像"、"docker pull"、"镜像源"、"registry mirror"、
  "中国 Docker"、"dockerfile"、"构建镜像"、"apt 源"、"Ubuntu 镜像"、"基础镜像"、
  "docker mirror"、"docker 代理"、"拉不到镜像"、"镜像加速" 时触发。
  也在用户需要拉取 PostgreSQL、Redis、Nginx、Go、Node、Python、MySQL、MongoDB 等常用镜像时触发。
---

# Docker Helper — 中国区 Docker 镜像助手

## 核心能力

1. **镜像源配置** — 检测当前环境，配置最优的中国区 Docker Registry 镜像源
2. **镜像代理拉取** — 通过可用的镜像代理拉取 Docker Hub 镜像
3. **Ubuntu 基础镜像构建** — 生成带中国 apt 源的 Ubuntu Dockerfile
4. **常用镜像快速拉取** — 一键拉取常用基础镜像（PG、Redis、Nginx、Go 等）

## 镜像源与代理清单

### Docker Registry 镜像源（daemon.json）

这些是 Docker daemon 级别的镜像加速器，配置后 `docker pull` 自动走镜像：

| 镜像源 | 地址 | 状态 | 说明 |
|--------|------|------|------|
| 腾讯云 | `https://mirror.ccs.tencentyun.com` | 活跃 | 腾讯云内网/公网均可用 |
| 中科大 | `https://docker.mirrors.ustc.edu.cn` | 活跃 | 教育网速度优秀 |
| 网易云 | `https://hub-mirror.c.163.com` | 不稳定 | 备用 |
| Docker CN | `https://registry.docker-cn.com` | 已停用 | 仅作历史参考 |

### 镜像代理前缀（直接在镜像名前加前缀拉取）

当 daemon.json 镜像源不可用时，用代理前缀直接拉取：

| 代理 | 前缀 | 用法示例 | 说明 |
|------|------|----------|------|
| 1ms.run | `docker.1ms.run/` | `docker pull docker.1ms.run/library/nginx:alpine` | 当前最稳定的代理 |
| daocloud | `docker.io/daocloud.io/` | 不稳定 | 备用 |

### 注意事项

- 2024 年后中国 Docker 镜像源大面积失效，代理前缀方式（如 `docker.1ms.run`）比 daemon.json 镜像源更可靠
- daemon.json 镜像源和代理前缀可以同时使用，互为 fallback
- 代理前缀方式需要改镜像名（加前缀），打 tag 时注意去前缀

## 工作流程

### 1. 环境检测

收到任务后先检测：

```bash
# Docker 是否安装且运行
docker info 2>&1 | head -5

# 当前镜像源配置
cat /etc/docker/daemon.json 2>/dev/null

# 已有镜像
docker images
```

### 2. 配置镜像源

如果 daemon.json 未配置或配置过时，更新配置：

```bash
# 备份原有配置
sudo cp /etc/docker/daemon.json /etc/docker/daemon.json.bak 2>/dev/null

# 写入新配置
sudo tee /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.mirrors.ustc.edu.cn"
  ]
}
EOF

# 重启 Docker
sudo systemctl restart docker
```

### 3. 拉取镜像

#### 方法 A：直接拉取（走 daemon.json 镜像源）

```bash
docker pull postgres:16-alpine
docker pull redis:7-alpine
docker pull nginx:alpine
docker pull golang:1.23-alpine
```

#### 方法 B：代理前缀拉取（当方法 A 失败时）

```bash
docker pull docker.1ms.run/library/postgres:16-alpine
docker pull docker.1ms.run/library/redis:7-alpine
docker pull docker.1ms.run/library/nginx:alpine
docker pull docker.1ms.run/library/golang:1.23-alpine
```

代理前缀拉取后需要重新打 tag：

```bash
docker tag docker.1ms.run/library/postgres:16-alpine postgres:16-alpine
docker tag docker.1ms.run/library/redis:7-alpine redis:7-alpine
```

#### 拉取策略

1. 先尝试直接 `docker pull`（走 daemon.json 镜像源）
2. 如果失败（超时或 403），自动切换到 `docker.1ms.run/` 代理前缀
3. 代理前缀也失败时，尝试其他可用代理或建议用户配置 VPN

### 4. 基于 Ubuntu 构建镜像

生成带中国 apt 源的 Dockerfile：

```dockerfile
FROM ubuntu:24.04

# 替换为阿里云 apt 源
RUN sed -i 's|http://archive.ubuntu.com|https://mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true \
    && sed -i 's|http://security.ubuntu.com|https://mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true \
    && sed -i 's|http://archive.ubuntu.com|https://mirrors.aliyun.com|g' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*
```

Ubuntu 24.04 使用新格式 `/etc/apt/sources.list.d/ubuntu.sources`，旧的 `sources.list` 方式可能无效。
生成 Dockerfile 时需要处理两种格式：

- **旧格式（<24.04）**：`sed -i` 替换 `sources.list`
- **新格式（>=24.04）**：`sed -i` 替换 `ubuntu.sources`，或直接写入新文件

#### 推荐的 apt 镜像源

| 源 | 地址 | 说明 |
|----|------|------|
| 阿里云 | `https://mirrors.aliyun.com/ubuntu/` | 最快最稳定 |
| 清华 | `https://mirrors.tuna.tsinghua.edu.cn/ubuntu/` | 教育网优选 |
| 中科大 | `https://mirrors.ustc.edu.cn/ubuntu/` | 教育网备选 |
| 网易 | `https://mirrors.163.com/ubuntu/` | 备用 |

### 5. 常用基础镜像清单

以下是开发中常用的基础镜像，按分类整理：

#### 数据库
| 镜像 | 推荐版本 | 大小 |
|------|----------|------|
| postgres | `16-alpine` / `15-alpine` | ~80MB |
| redis | `7-alpine` | ~40MB |
| mysql | `8.0` | ~580MB |
| mongodb | `7.0` | ~700MB |
| mariadb | `11` | ~400MB |

#### Web 服务器 / 反向代理
| 镜像 | 推荐版本 | 大小 |
|------|----------|------|
| nginx | `alpine` / `1.25-alpine` | ~45MB |
| caddy | `alpine` | ~50MB |
| traefik | `v3.0` | ~150MB |

#### 语言运行时
| 镜像 | 推荐版本 | 大小 |
|------|----------|------|
| golang | `1.23-alpine` / `1.21-alpine` | ~230MB |
| node | `22-alpine` / `20-alpine` | ~160MB |
| python | `3.12-slim` / `3.11-slim` | ~130MB |
| eclipse-temurin | `17-jdk` / `21-jdk` | ~450MB |

#### 消息队列 / 工具
| 镜像 | 推荐版本 | 大小 |
|------|----------|------|
| rabbitmq | `3.12-management` | ~250MB |
| minio/minio | `latest` | ~170MB |

#### 基础系统
| 镜像 | 推荐版本 | 大小 |
|------|----------|------|
| ubuntu | `24.04` / `22.04` | ~78MB |
| alpine | `3.19` | ~7MB |
| debian | `bookworm-slim` | ~75MB |

## 错误处理

### 拉取失败时的诊断步骤

1. `docker pull` 超时 → 检查网络，切换代理前缀
2. `TLS handshake timeout` → 镜像源不可用，换代理
3. `unauthorized` / `403` → 镜像源已停服，需要切换
4. `not found` → 镜像名或版本号错误，检查 Docker Hub
5. `disk full` → `docker system prune` 清理空间

### 清理磁盘空间

```bash
# 查看磁盘占用
docker system df

# 清理无用资源（悬空镜像、停止的容器、未用网络）
docker system prune -f

# 深度清理（包括未使用的镜像）
docker system prune -a -f
```
