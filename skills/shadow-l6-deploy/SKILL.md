---
name: shadow-l6-deploy
alias: Shadow·L6-Deploy
description: |
  Shadow L6 部署验证 — 穷尽式诊断验证应用可部署、可启动、可测试（后端 + 前端）。
  禁止偷懒归因（"网络问题""环境问题"必须有证据链）。
  每个失败必须穷举至少3种假设并逐个验证。
  最终结论必须满足 Real Usability Contract：真实持久化、真实认证、跨服务链路、重启后数据保留和 P0 UAT 证据。
  最终验收必须满足 Production Acceptance Contract：真实用户愿意在真实工作中依赖它。
  触发：部署、L6、启动、验证。
version: "7.3.0"
---

# Shadow L6 — 部署验证（穷尽诊断版）

## 角色

验证整个应用能跑起来。
最终验收必须像真实用户一样使用系统：用户怎么登录、怎么导航、怎么点击、怎么提交、怎么等待结果、怎么查看反馈，L6 就怎么测。

**核心原则**：失败时必须穷尽诊断。禁止把问题归因于"网络问题"、"环境问题"、"沙箱隔离"等笼统原因
而不提供证据链。如果一次尝试失败，必须至少换3种方式再试，才能确认是真正的阻塞。

**真正可用原则**：服务启动、健康检查 200、API 返回 201、单元测试通过都只是局部证据。最终 `DEPLOY_PASS` 必须符合 `references/real-usability-contract.md`：真实持久化、真实认证、跨服务链路、重启后数据保留和 P0 UAT 证据全部闭合。

**生产级验收原则**：最终 `DEPLOY_PASS` 还必须符合 `references/production-acceptance-contract.md`。验收通过不是"功能都实现了"，而是"真实用户愿意在真实工作中依赖它"。L6 必须证明真实用户可以拿真实数据完成真实工作，系统出错时可发现、可解释、可恢复、可追责。

**漫游质量底线**：Phase 5.6 系统漫游不只是发现问题，更要为修复闭环提供可操作的材料。漫游发现的所有问题（P0/P1/P2，一个不漏）必须详细记录（根因精确到代码层面、修复建议精确到文件和改动点、设计层缺失标注回退层），供 Shadow team 派发正确的修复 agent。不允许带着任何级别的漫游问题交付。不允许只记录不修复。

## 怎么做

**复杂度缩放**：如果 `.shadow/scale.md` 存在且 `l6_core_phases_only = true`，仅执行 Phase 0-3（环境+启动+健康检查）+ Phase 7-9（UAT+报告+自检）。Phase 4-6（API 端点详细验证 + Playwright E2E + 系统漫游 + 后端 E2E）由 Phase 7 UAT 合并覆盖，不再单独执行。否则执行全部 Phase。

### Phase 0: 前置环境验证

在动手之前，先确认执行环境的能力，避免后续误判。检查核心工具链（Docker Compose 强制）、Playwright（前端项目强制）、端口可用性、Docker 可达性。

详细步骤见 `references/phase-detail-0-3.md`。

**Docker compose 是强制启动方式。如果 docker-compose.yml 不存在 = L1.5 架构设计有缺失，记录为架构缺陷后退回。**
**如果包含前端且 Playwright 不可用 = 部署环境不完整，安装后再继续。**

### Phase 1: 检查启动配置（Docker Compose 为主）

检查 docker-compose.yml / Dockerfile / .env 存在性，验证 `docker compose config` 合法性。如果 docker-compose.yml 缺失 → 记录架构缺陷，阻塞部署流程。

详细步骤见 `references/phase-detail-0-3.md`。

### Phase 2: 构建验证（docker compose build）

执行 `docker compose build`，失败时降级到 `npm build` 以区分 Docker 问题还是代码问题。构建失败需诊断基础镜像、Node 版本、TypeScript 错误、依赖安装等。

详细步骤见 `references/phase-detail-0-3.md`。

### Phase 3: 启动服务 + 多角度健康检查（docker compose 为主）

`docker compose up -d --wait` 是主启动方式。`--wait` 会等待所有服务 healthcheck 通过。启动后逐服务验证健康状态和 API 健康端点。失败时进入诊断模式，至少验证端口冲突、构建失败、崩溃循环 3 种假设。

详细步骤（含多假设诊断树）见 `references/phase-detail-0-3.md`。

**关键原则**：你不能只试一次就说是"网络问题"。至少试3种以上方式确认确实是网络不可达。

### Phase 4: API 端点验证（通过 docker compose）

对 docker compose 运行中的服务做内部（容器内 exec curl）和外部（宿主机 curl）双重验证。业务端点返回非 200 时必须诊断：错误 JSON、认证问题、数据库初始化、容器内网络。

详细步骤见 `references/phase-detail-4-6.md`。

### Phase 5: 前端 E2E 验证 — Playwright（如有前端）

如果项目包含前端，**必须使用 Playwright CLI 进行端到端测试**，不能只做 HTTP 可达性检查。L2 e2e.md 中的真实场景必须被 Playwright 测试覆盖。

流程：安装 Playwright → 确认前端容器就绪 → 运行测试（有配置用项目配置，无配置用临时配置）。测试必须覆盖 L2 P0 用户验收剧本，至少 2 个前端真实场景，截图/trace/网络请求必须落盘。

详细步骤（含安装、就绪检查、运行、覆盖要求、诊断）见 `references/phase-detail-4-6.md`。Playwright CLI 详细用法见 `references/playwright-cli.md`。

### Phase 5.6: 系统漫游测试（Exploratory Wander Test）

> 像真实用户第一次拿到系统一样，随便逛、随便点、随便输入。
> 脚本化测试验证的是"我们想验证的"，漫游测试发现的是"我们没想过的"。

**适用范围**：有前端的项目。纯后端/API 项目豁免。

**核心定位**：Phase 5 验证已知路径，Phase 7 验证用户验收剧本，**Phase 5.6 发现未知问题**。

漫游执行分 5 层：页面发现+全量截图 → 浏览器错误捕获 → 表单胡搞 → 死胡同检测 → 视觉一致性扫描。所有证据保存到 `wander-evidence/`。

问题分级：P0 阻塞 L6 PASS（JS 白屏/核心流程中断/数据丢失/安全漏洞/死胡同卡死），P1 必须报告+修复建议，P2 必须修复。所有问题写入 `issues.json`，包含根因分析、修复建议、建议 agent 路由。

详细步骤（含 5 层策略、证据包、问题分级、诊断表、issues.json 格式、agent 路由表、通过标准）见 `references/phase-detail-4-6.md`。
详细方法论参考：`references/exploratory-wander.md`。

### Phase 6: 后端 E2E 场景验证

**核心要求：所有测试必须针对 `docker compose` 启动并正在运行的 dev 服务执行。** 不得使用独立测试数据库启动方式。

流程：验证 dev 服务运行中 → 准备测试数据（≥100 条记录）→ 运行 E2E（容器内集成测试 / API scenario replay / test profile）。L2 e2e.md 每个核心规则至少 1 个 E2E 场景，全部 GREEN 才通过。

详细步骤见 `references/phase-detail-4-6.md`。

### Phase 7: UAT 用户验收执行（最终通过门槛）

读取 `.shadow/L2-e2e/BXX-{slug}/uat-script.md`，按真实用户路径执行验收。没有 `uat-script.md` 时，L6 不能声明最终验收通过，只能标记为 DEPLOY_PARTIAL。

有前端用 Playwright 驱动真实浏览器；纯后端用 API scenario replay；有异步/外部服务需验证失败/超时/重试路径。每条 UAT 剧本必须生成截图、网络请求、数据状态证据。

详细步骤（含执行方式、证据包、通过标准）见 `references/phase-detail-7-9.md`。

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

禁止把以下内容当作真正可用：`docker compose ps` healthy、`/api/health` 200、创建 201 无持久化证据、单元测试通过、InMemoryRepository/mock DB/假登录路径。

详细步骤见 `references/phase-detail-7-9.md`。

### Phase 7.6: 生产级验收验证（Production Acceptance）

引用标准：`references/production-acceptance-contract.md`。

L6 必须回答：真实用户是否愿意在真实工作中依赖这个系统？

| 闭环 | L6 必须采集的证据 |
|------|-------------------|
| 业务 | 真实角色完成 P0 主流程，不需工程师手工补步骤 |
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

详细步骤见 `references/phase-detail-7-9.md`。

### Phase 8: 生成部署报告

部署报告模板见 `templates/L6.md`。报告必须包含以下章节，缺少任何一项视为不完整：

1. **环境基线** — Docker/Node 版本、端口状态、compose 文件存在性
2. **启动配置** — Dockerfile/.env 存在性、compose config 合法性、构建结果
3. **服务启动** — 启动方式、耗时、各服务健康状态、健康检查结果
4. **API 验证** — 各端点 HTTP 状态码
5. **前端 E2E / Playwright** — 测试结果、覆盖场景数、报告路径
6. **系统漫游** — 漫游深度、页面地图、截图数、P0/P1 问题、证据目录
7. **后端 E2E** — 测试方法、数据量、场景覆盖、通过率
8. **UAT 用户验收** — 剧本来源、执行结果、证据目录
9. **真正可用验证** — persistence/restart/auth/cross_service/uat_execution 各项证据
10. **生产级验收验证** — business/data/permission/state/exception/ux/integration/ops/performance/evidence 各闭环
11. **诊断记录** — 每个失败的假设验证表、根因、解决方案
12. **结论** — DEPLOY_PASS / DEPLOY_FAIL / DEPLOY_PARTIAL

完整报告模板见 `references/phase-detail-7-9.md`。

## 诊断铁律

1. **一个失败至少验证3种假设** — 单一假设直接归因视为偷懒
2. **禁止"网络问题""环境问题""沙箱隔离"等无证据归因** — 必须有具体的 `ss`/`curl`/`ps` 输出做证据
3. **失败时必须贴证据** — 不是"服务不可用"，而是 `curl 返回 code=000, timeout after 5s, ss 显示端口无人监听`
4. **N/A 不算诊断** — "Docker 不可用"不是终点，换 npm 方案继续
5. **所有临时修复必须记录** — kill 旧进程、改端口、加依赖，都要写进报告

## Phase 9: 层内自检（L6 Gate）

部署验证完成后，执行 L6 层内自检。核心是**审查部署报告的质量**，不只看结论。

### 自检清单

#### 结构性检查
1. deployment-report.md 存在 → 否则直接 FAIL
2. 报告包含 7 个章节 → 缺章节 FAIL

#### 诊断质量检查（有失败时必须）
3. **每个失败有 ≥3 种假设验证记录**
4. **没有"网络问题""环境问题""沙箱限制"等无证据归因** → 自动 FAIL
5. **所有临时修复有记录**
6. **根因分析到位**
7. **证据链完整**

#### 功能性检查
8. 启动配置完整（含依赖安装）
9. 健康检查通过（HTTP 200 或预期响应）
10. 关键API端点验证通过
11. L2 e2e场景至少验证核心场景
12. `uat-script.md` 存在，且部署报告逐条引用 UAT 剧本
13. P0 UAT 剧本 100% PASS
14. UAT 证据包存在，至少包含截图/网络请求/最终数据状态证据
15. 前端验收必须有截图（纯后端可豁免）
16. 真正可用验证章节存在，且 `real_usability: PASS`
17. 持久化证据存在
18. 重启保留证据存在
19. 认证证据存在
20. 跨服务证据存在
21. 生产级验收章节存在，且 `production_acceptance: PASS`
22. 漫游测试章节存在（有前端时）
23. 漫游页面地图完整（≥ 3 层深度）
24. 漫游截图证据存在
25. 漫游错误证据充分
26. 漫游 P0 问题有根因+修复建议
27. 漫游无偷懒
28. 漫游 issues.json 存在且完整
29. 漫游设计层回退标注

详细检查项说明见 `references/phase-detail-7-9.md`。L6 门禁详细说明见 `references/gate-l6.md`。

#### 偷懒信号识别

| 偷懒信号 | 处理 |
|---------|------|
| "N/A" 出现超过1次 | 打回 — 没有"不适用"，只有"没试" |
| 只有结论没有日志输出 | 打回 — 证据呢？ |
| "可能是……"没有"实际验证了……" | 打回 — 推测不是诊断 |
| 所有检查都是 PASS 但没有操作记录 | 打回 — 你怎么确定 PASS 的？ |
| UAT PASS 但没有截图/网络/数据证据 | 打回 — 这不是用户验收，只是口头结论 |
| 前端页面/UAT 场景没有截图 | 打回 — 必须使用 `playwright-cli screenshot` 截取 |
| API 返回 200/201 就声明可用 | 打回 — 只是连通性，不是业务可用 |
| 使用 InMemoryRepository / mock DB / 假登录完成 UAT | 打回 — 真实用户不能使用这种系统 |
| 只说"功能都实现了" | 打回 — 验收标准是真实工作可依赖 |
| 漫游报告"未发现明显问题"但没有页面地图 | 打回 — 没有页面地图说明没有真的漫游 |
| 漫游只有 2-3 张截图 | 打回 — 正常系统至少 5+ 页面 |
| 漫游 P0 问题没有根因和修复建议 | 打回 — "有问题"不是报告 |
| 漫游 console 错误数为 0 但有页面白屏 | 打回 — 错误捕获没有正确注入 |
| 漫游页面地图只有一级深度 | 打回 — DFS 至少要深入 3 层 |
| "由于时间关系只测试了部分页面" | 打回 — 全量遍历是强制要求 |
| 漫游发现 P0 但 L6 结论写 PASS | 打回 — P0 阻塞 L6 PASS |
| 漫游发现问题但 issues.json 不存在 | 打回 — 没有问题清单说明没打算修复 |
| 漫游 P0/P1 没有 root_cause 和 fix_suggestion | 打回 — 要能直接派 agent 修 |
| 漫游设计层缺失但 trace_to_design 为空 | 打回 — 不允许掩盖上游设计缺失 |

### 自检判定
- **PASS**: 全部检查项通过，P0 UAT 100% PASS，真正可用和生产级验收均 PASS 且证据完整 → 创建 `{迭代门禁目录}/l6.{slug}.passed`（门禁目录为 `.shadow/iterations/{当前迭代}/gate/`）
- **PARTIAL**: 功能有缺陷但有完整诊断记录 + 明确阻塞项 + 替代方案 → 不创建 .passed，只输出 PARTIAL 审查结论
- **FAIL**: 诊断不完整 / 偷懒信号 / 结构缺失 → 不创建 .passed，输出审查报告要求重做
