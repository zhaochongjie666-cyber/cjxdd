---
name: xdd-l6
alias: xdd·L6-Deploy
description: |
  xdd Phase 6 VERIFY 部署验证 — 穷尽式诊断应用可部署/可启动/可测试（后端+前端）。
  禁偷懒归因 (网络/环境问题必须有证据链). 失败必穷举 ≥3 假设并逐个验证.
  最终必须满足 Real Usability Contract (真实持久化/认证/跨服务链路/重启数据保留/P0 UAT 证据)
  + Production Acceptance Contract (真实用户愿在真实工作中依赖).
  子阶段 (l6_required=true): health-check / wander-test / production-scenarios.
  触发: 部署、verify、l6、启动、验证。
version: "7.4.0"
---

# xdd L6 — 部署验证（穷尽诊断版）

## 角色

验证整个应用能跑起来。
最终验收必须像真实用户一样使用系统：用户怎么登录、怎么导航、怎么点击、怎么提交、怎么等待结果、怎么查看反馈，L6 就怎么测。

**核心原则**：失败时必须穷尽诊断。禁止把问题归因于"网络问题"、"环境问题"、"沙箱隔离"等笼统原因
而不提供证据链。如果一次尝试失败，必须至少换3种方式再试，才能确认是真正的阻塞。

**真正可用原则**：服务启动、健康检查 200、API 返回 201、单元测试通过都只是局部证据。最终 `DEPLOY_PASS` 必须符合 `references/real-usability-contract.md`。

**生产级验收原则**：最终 `DEPLOY_PASS` 还必须符合 `references/production-acceptance-contract.md`。验收通过不是"功能都实现了"，而是"真实用户愿意在真实工作中依赖它"。

**漫游质量底线**：Phase 5.6 系统漫游不只是发现问题，更要为修复闭环提供可操作的材料。漫游发现的所有问题（P0/P1/P2）必须详细记录（根因精确到代码层面、修复建议精确到文件和改动点）。

## 产出

> **生命周期角色**: 混合 — `deployment-report.md` 文件 = `process_output` 过程产物;`wander-evidence/` 截图 + trace / `chaos-drill-evidence/` 注入证据 = `evidence_archive` 证据存档(只读不可变);`issues.json` P0/P1/P2 + root_cause + fix_suggestion = `evidence_archive` 证据存档。

## 怎么做

**复杂度缩放**：如果 `.xdd/scale.md` 存在且 `l6_core_phases_only = true`，仅执行 Phase 0-3（环境+启动+健康检查）+ Phase 7-9（UAT+报告+自检）。否则执行全部 Phase。

### Phase 0: 前置环境验证

核心工具链（Docker Compose 强制）、Playwright（前端项目强制）、端口可用性、Docker 可达性。

**Docker compose 是强制启动方式。如果 docker-compose.yml 不存在 = L1.5 架构设计有缺失，记录为架构缺陷后退回。**
**如果包含前端且 Playwright 不可用 = 部署环境不完整，安装后再继续。**

### Phase 1: 检查启动配置（Docker Compose 为主）

检查 docker-compose.yml / Dockerfile / .env 存在性，验证 `docker compose config` 合法性。

### Phase 2: 构建验证（docker compose build）

执行 `docker compose build`，失败时降级到 `npm build` 以区分 Docker 问题还是代码问题。

### Phase 3: 启动服务 + 多角度健康检查

`docker compose up -d --wait` 是主启动方式。`--wait` 会等待所有服务 healthcheck 通过。

**验证场景格式**：

```gherkin
  Scenario: 服务健康检查通过
    Given docker compose up -d --wait 已执行
    When curl http://localhost:3000/api/health
    Then HTTP 状态码 200
      And 响应体 { "status": "ok" }
```

### Phase 4: API 端点验证（通过 docker compose）

对 docker compose 运行中的服务做内部（容器内 exec curl）和外部（宿主机 curl）双重验证。

### Phase 5: 前端 E2E 验证 — Playwright（如有前端）

如果项目包含前端，**必须使用 Playwright CLI 进行端到端测试**。

流程：安装 Playwright → 确认前端容器就绪 → 运行测试（有配置用项目配置，无配置用临时配置）。测试必须覆盖 BDD P0 用户验收剧本。

### Phase 5.6: 系统漫游测试（Exploratory Wander Test）

> 像真实用户第一次拿到系统一样，随便逛、随便点、随便输入。

**适用范围**：有前端的项目。纯后端/API 项目豁免。

漫游执行分 5 层：页面发现+全量截图 → 浏览器错误捕获 → 表单胡搞 → 死胡同检测 → 视觉一致性扫描。所有证据保存到 `wander-evidence/`。

问题分级：P0 阻塞 L6 PASS（JS 白屏/核心流程中断/数据丢失/安全漏洞/死胡同卡死），P1 必须报告+修复建议，P2 必须修复。

### Phase 5.7: 灾难演练（L3 韧性层验证）

> Phase 5.6 漫游是"未知 UX 问题"，Phase 5.7 灾难演练是"已知失败的可控实验"。

**L3 位置**：消费 L3 `chaos-scenarios.md` 的 P0 场景（@chaos 标签）。

**核心定位**：把 L3 `failsafe-design.md` 列出的兜底策略，在真实运行环境（docker compose 启动的服务）下做可控注入实验，验证：
1. 兜底机制真的工作
2. 数据完整性（故障期间用户操作不丢失、恢复后能合并）
3. 故障消除后能自动/手工恢复
4. 故障对用户可见的副作用

**核心步骤**：
1. 读 L3 chaos-scenarios.md 的 P0 场景
2. 每个场景至少跑 3 次（确认可复现）
3. 场景执行格式（每个 @chaos 场景）：

```gherkin
@chaos @P0 @failure-mode-F12
Scenario: 网络分区下标注提交降级
  Given 服务已启动
    And 标注员已登录
    And 任务 TASK-001 状态 IN_PROGRESS
  When 模拟下游 API 网络分区 30s
    And 标注员尝试提交标注
  Then 系统在 5s 内触发熔断
  When 撤销网络分区
  Then 30s 内熔断器自动转 HALF_OPEN
    And 草稿自动同步到主存储
```

4. 证据保存到 `chaos-drill-evidence/`
5. 问题分级：P0 阻塞 L6 PASS，P1 必须报告，P2 记录改进项

### Phase 5.8: 穷尽式生产场景自动跑（l6_required=true）

跟 Phase 5 / 5.6 互补不重复：
- Phase 5 验证已实现的代码跑得对不对
- Phase 5.6 漫游发现未知 UX 问题
- **Phase 5.8 验证跟生产一致的真实账号 / 真实数据 / 真实跨服务**

**前置**：跟前 Phase 一致 — docker compose 已起, 前端可访问, L3 chaos-scenarios 已读. 此外需真实账号 env：
- `E2E_USER_*` / `E2E_PASSWORD` / `E2E_TENANT_ID`
- `E2E_BASE_URL` (前端 URL)
- `E2E_DB_*` (DB 直连)
- `E2E_REDIS_*` (事件总线)

**执行**：
```bash
bash skills/xdd-l6/scripts/run-production-scenarios.sh {slug}
```

**退出码契约**：
| 退出码 | 含义 | 处理 |
|--------|------|------|
| 0 | 所有 @P0 spec 通过 | 写 smoke-test-passed marker, 4 层验证 PASS |
| 1 | Playwright 测试失败 | 不写 marker, evidence 落 prod-evidence/ |
| 2 | 契约违反 (缺 config / 缺 env) | 不写 marker |
| 3 | Spec 存在但 selector 不存在 | 不写 marker, 派 L5-impl 修 selector |

**evidence 落点**: `.xdd/iterations/iter-N/L6-deploy/{slug}/prod-evidence/`

### Phase 6: 后端 E2E 场景验证

**核心要求：所有测试必须针对 `docker compose` 启动并正在运行的 dev 服务执行。** 不得使用独立测试数据库启动方式。

### Phase 7: UAT 用户验收执行（最终通过门槛）

读取 `.xdd/L1-bdd/BXX-{slug}/uat-script.md`，按真实用户路径执行验收。

**通过标准**：
- 每条 UAT 剧本必须生成截图、网络请求、数据状态证据
- 真实账号登录 + 真实持久化 + 跨服务链路 + 重启后数据保留

### Phase 7.5: 真正可用验证（Real Usability）

引用标准：`references/real-usability-contract.md`。

L6 只有在以下证据都存在时才能声明 `DEPLOY_PASS`：

| 证据 | 验证要求 |
|------|----------|
| `persistence_proof` | 通过真实页面/API 创建业务数据，再通过 API/DB/列表查询到同一数据 |
| `restart_survival_proof` | 重启 backend 或 compose 服务后，同一业务数据仍可查询 |
| `auth_proof` | 真实账号登录成功，越权角色访问被拒绝 |
| `cross_service_proof` | 前端或 HTTP scenario 触发后端 API，并在真实存储中产生业务状态变化 |
| `uat_execution_proof` | P0 UAT 剧本 100% 执行，有截图、网络请求和最终数据状态证据 |

### Phase 7.6: 生产级验收验证（Production Acceptance）

引用标准：`references/production-acceptance-contract.md`。

L6 必须回答：真实用户是否愿意在真实工作中依赖这个系统？

| 闭环 | L6 必须采集的证据 |
|------|-------------------|
| 业务 | 真实角色完成 P0 主流程 |
| 数据 | 创建/处理/查询/导出/回溯一致，重启后仍可查 |
| 权限 | 登录、授权、越权拒绝、审计日志证据 |
| 状态 | pending/running/success/failure/partial/cancel/rework 等状态可解释、可恢复 |
| 异常 | 网络失败、任务失败、部分失败、重复提交、并发冲突的恢复路径 |
| UX | 用户可见的下一步、成功结果、失败原因、重试/修正入口 |
| 集成 | 前端/API → 后端 → DB/对象存储/队列/外部服务的 trace |
| 运维 | 日志、trace/request id、重试、回滚、备份或数据修复路径 |
| 性能 | 目标数据量、并发量、任务量下的 smoke/批量验收结果 |
| 证据 | 截图、network、日志、trace、DB/存储查询、导出文件路径 |

任一 P0 闭环缺失，结论不得写 `DEPLOY_PASS`；最多写 `DEPLOY_PARTIAL`。

### Phase 8: 生成部署报告

部署报告必须包含以下章节：
1. 环境基线
2. 启动配置
3. 服务启动
4. API 验证
5. 前端 E2E / Playwright
6. 系统漫游
7. 后端 E2E
8. UAT 用户验收
9. 真正可用验证
10. 生产级验收验证
11. 韧性验证（L3 灾难演练）
12. 诊断记录
13. 结论

## 诊断铁律

1. **一个失败至少验证3种假设** — 单一假设直接归因视为偷懒
2. **禁止"网络问题""环境问题""沙箱隔离"等无证据归因** — 必须有具体的 `ss`/`curl`/`ps` 输出做证据
3. **失败时必须贴证据** — 不是"服务不可用"，而是 `curl 返回 code=000, timeout after 5s, ss 显示端口无人监听`
4. **N/A 不算诊断** — "Docker 不可用"不是终点，换 npm 方案继续
5. **所有临时修复必须记录** — kill 旧进程、改端口、加依赖，都要写进报告

## 真实烟雾测试 (R11 门禁)

部署完成后, Walker 必须为每个 L6-deploy/{slug}/ 写 marker:

```bash
TS=$(date -Iseconds)
echo "${TS} | login E2E: POST /api/auth/login 200 + browser navigated to /home + 后续 GET /api/me 200" \
    > .xdd/iterations/iter-N/L6-deploy/{slug}/smoke-test-passed
```

R11 检测逻辑(`gate-check-lifecycle.sh` 自动跑):
- 扫 `.xdd/iterations/iter-N/L6-deploy/*/smoke-test-passed`
- marker mtime < 7 天 → pass(新近的真实验证)
- marker mtime ≥ 7 天 → warn (stale)
- 完全没有 marker → warn (缺 marker)

新项目 4 层验证：marker 存在 + 首行正则 / 邻目录 prod-evidence/summary.json.failed == 0 / prod-config-hash 一致。

## Phase 9: 层内自检（L6 Gate）

部署验证完成后，执行 L6 层内自检。核心是**审查部署报告的质量**，不只看结论。

### 自检判定
- **PASS**: 全部检查项通过，P0 UAT 100% PASS，真正可用和生产级验收均 PASS 且证据完整 → 创建 `{迭代门禁目录}/l6.{slug}.passed`
- **PARTIAL**: 功能有缺陷但有完整诊断记录 + 明确阻塞项 + 替代方案
- **FAIL**: 诊断不完整 / 偷懒信号 / 结构缺失
