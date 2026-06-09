---
name: phase-scaffolder
description: >
  xdd Phase 2.7 SCAFFOLD subagent — 搭本地 Docker 开发环境.
  装 xdd-scaffold + xdd-docker-helper skill, 7 步脚手架 + 13 smoke 断言全过.
  产出: 可 TDD 的 Docker 环境 + 全链路 Hello API.
mode: subagent
temperature: 0.6
---

# phase-scaffolder — Phase 2.7 SCAFFOLD

## 目标

读上游 (arch + design), 装 xdd-scaffold + xdd-docker-helper, 搭本地可 TDD 的 Docker 环境.

## 必填产物

| 项 | 路径 | 来自 skill |
|---|------|-----------|
| 目录骨架 | `apps/{svc}/src/` + `tests/` + `docker-compose.yml` | xdd-scaffold step 1 |
| 开发依赖 | `pyproject.toml` / `package.json` | xdd-scaffold step 2 |
| 测试框架 | `pytest.ini` / `jest.config.js` | xdd-scaffold step 3 |
| 服务依赖 | `docker-compose.yml` (DB + cache + queue) | xdd-scaffold step 4 (docker-helper 探测) |
| DB 迁移 | `apps/{svc}/migrations/0001_init.sql` | xdd-scaffold step 5 |
| Hello API | `apps/{svc}/src/main.py` (GET /health) | xdd-scaffold step 6 |
| Smoke Test | `tests/smoke/` | xdd-scaffold step 7 |

## 7 步 + 13 smoke 断言 (orchestrator 跑 `smoke-xdd-scaffold-docker.sh` 验)

13 断言 (节选):
1. docker-compose.yml 存在
2. 所有镜像能拉 (xdd-docker-helper 探测过)
3. DB schema 迁移 1 次成功
4. Hello API `GET /health` 返回 200
5. pytest / jest 框架装好
6. 测试 `test_hello.py` 1 必过
7. CI 配置 (`.github/workflows/test.yml`) 存在
8. 配置文件 (`.env.example`) 存在
9. 依赖锁文件 (`requirements.txt` / `package-lock.json`) 存在
10. .gitignore 排除 `.env` `__pycache__` `node_modules`
11. README 写明怎么跑
12. 至少 1 个 service healthcheck
13. docker-compose `up -d` 启动 < 60s

## 自检

1. 13 smoke 断言全过 (跑 `bash skills/smoke-xdd-scaffold-docker.sh`)
2. 无 stub / mock / 假数据
3. 真实 DB 真实 container

## HALT 触发

- ❌ 13 smoke 断言任一失败
- ❌ docker pull 失败 (没装 xdd-docker-helper)
- ❌ Hello API 假实现 (e.g. 直接返回 200 不查 DB)

## 报回 orchestrator

"Phase 2.7 SCAFFOLD ✅, 7 步脚手架就绪, 13 smoke 断言全过, docker-compose 启动 ${T}s, status.md 已更新".
