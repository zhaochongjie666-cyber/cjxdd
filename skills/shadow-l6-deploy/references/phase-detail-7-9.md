# Phase 7-9 详细步骤：UAT / 真正可用 / 生产级验收 / 报告 / 自检

> 本文件从 SKILL.md 拆分，包含 Phase 7 到 Phase 9 的完整细节。

---

## Phase 7: UAT 用户验收执行

读取 `.shadow/L2-e2e/BXX-{slug}/uat-script.md`，按真实用户路径执行验收。没有 `uat-script.md` 时，L6 不能声明最终验收通过，只能标记为 DEPLOY_PARTIAL。

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

禁止把以下内容当作真正可用：
- `docker compose ps` healthy。
- `/api/health` 返回 200。
- 创建接口返回 201 但没有查询/持久化证据。
- 单元测试总数通过，如 `109 tests PASSED`。
- 使用 InMemoryRepository、mock DB、假登录路径跑通的场景。

如果缺少任一 P0 证据，结论必须是 `DEPLOY_FAIL` 或 `DEPLOY_PARTIAL`，且不得创建 L6 `.passed`。

### Phase 7.6: 生产级验收验证（Production Acceptance）

引用标准：`references/production-acceptance-contract.md`。

L6 必须回答：真实用户是否愿意在真实工作中依赖这个系统？必须证明真实用户可以拿真实数据完成真实工作，系统出错时可发现、可解释、可恢复、可追责。

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

任一 P0 闭环缺失，结论不得写 `DEPLOY_PASS`；最多写 `DEPLOY_PARTIAL`，并列出回退责任层。

### 7.1 UAT 执行方式

| 项目类型 | 执行方式 | 要求 |
|----------|----------|------|
| 有前端 | Playwright 驱动真实浏览器 | 按用户剧本点击真实页面，不直接调用内部函数，不 mock API |
| 纯后端/API | API scenario replay | 按用户剧本用真实 HTTP 请求串联业务步骤 |
| 有异步/外部服务 | API/页面 + 日志/队列/回调证据 | 验证成功路径和失败/超时/重试路径 |

### 7.2 UAT 证据包

每条 UAT 剧本必须生成证据，保存到 `{迭代作用域}/L6-deploy/{slug}/uat-evidence/`：

```text
{迭代作用域}/L6-deploy/{slug}/uat-evidence/
  UAT-01/
    screenshots/
      01-login.png
      02-operation.png
      03-result.png
    network.json
    trace.zip
    assertions.json
    data-proof.json
    result.md
```

证据要求：
- 截图：起始页、关键操作页、最终结果页。
- 网络请求：关键 API 的 method、url、status、响应摘要。
- 数据证据：最终 API 响应、DB 查询摘要、导出文件 hash 或业务状态。
- 副作用证据：通知、事件、审计、异步任务日志。
- 失败证据：如果失败，记录用户看到的错误提示和系统恢复路径。

### 7.3 UAT 通过标准

UAT 必须全部满足：
- P0 UAT 剧本 100% PASS。
- P1 UAT 剧本无阻塞失败；失败项必须有明确诊断和修复建议。
- 每条 PASS 剧本都有截图、网络请求、最终数据/状态证据。
- 没有跳过核心用户路径。
- 没有 mock 后端、mock 登录、mock 外部成功结果；如外部服务无法真实调用，必须用可审计的本地 fake 服务并记录证据。
- 用户可见反馈和业务最终状态都符合 L2 通过标准。
- 有持久化服务的项目，P0 UAT 必须包含重启后数据仍可查询的证据。

---

## Phase 8: 生成部署报告

部署报告必须包含以下内容，**缺少任何一项视为不完整**：

```markdown
# 部署报告

## 1. 环境基线
- Docker Compose: {version}
- Docker Engine: {version}
- Node (备用): {version}
- 端口状态: {port}=清空/占用(pid)
- docker-compose.yml: 存在/缺失
- docker-compose.test.yml: 存在/缺失

## 2. 启动配置
- Dockerfile: 存在/缺失
- .env: 存在/缺失
- docker compose config: 合法/非法
- 构建: PASS/FAIL（失败原因: xxx）
- 构建方式: docker compose build / 降级 npm build

## 3. 服务启动
- 启动方式: docker compose up -d --wait
- 启动耗时: x 秒
- 各服务状态: backend=healthy / db=healthy / redis=healthy
- 健康检查: PASS/FAIL
- 最后一次检查: HTTP {code}

## 4. API 验证（针对 docker compose 运行中的 dev 服务）
| 端点 | 状态 | HTTP | 备注 |
|------|------|------|------|
| /api/health | ✅/❌ | 200 | - |
| /api/projects | ✅/❌ | 200 | - |

## 5. 前端 E2E — Playwright（如有前端）
- Playwright 版本: {version}
- Chromium 已安装: YES/NO
- 测试目标: http://127.0.0.1:{frontend_port} (docker compose 运行中)
- Playwright 测试结果: PASS/FAIL / N/A(无前端)
- 覆盖场景数: {n}
- 测试报告: playwright-report/ (存在/缺失)

## 5.6 系统漫游测试（Exploratory Wander）
- 漫游起始页: {url}
- 漫游深度: {n} 层
- 发现页面数: {n}
- 截图数: {n}
- Console 错误: {n} 条
- HTTP 4xx/5xx: {n} 条
- P0 问题: {n} 个
- P1 问题: {n} 个
- 证据目录: `{迭代作用域}/L6-deploy/{slug}/wander-evidence/`

### 页面地图
| # | 页面标题 | URL | 深度 | 截图 | Console | HTTP | 状态 |
|---|---------|-----|:----:|------|:-------:|:----:|:----:|
| 1 | 首页 | / | 0 | wander-01.png | 0 | 0 | OK |

### 发现的问题
| # | 级别 | 页面 | 操作 | 现象 | 截图 | Console/Network 证据 | 根因分析 | 修复建议 |
|---|------|------|------|------|------|---------------------|---------|---------|
| （无 P0 问题时留空，但页面地图必须完整） |

## 6. 后端 E2E（针对 docker compose 运行中的 dev 服务）
- 测试目标: docker compose up -d --wait (运行中)
- 测试方法: container exec / API scenario / test profile
- 测试数据量: {n} 条
- | 场景 | 来源 (L2 e2e.md) | 结果 |
  |------|-------------------|------|
  | {场景名} | §{章节} | PASS/FAIL |
- 通过率: {n}/{m}

## 7. UAT 用户验收（按真实用户路径）
- UAT 剧本来源: `.shadow/L2-e2e/BXX-{slug}/uat-script.md`
- 执行目标: 运行中的真实服务 URL
- 证据目录: `{迭代作用域}/L6-deploy/{slug}/uat-evidence/`

| UAT | 角色 | 用户目标 | 执行方式 | 结果 | 证据 |
|-----|------|----------|----------|------|------|
| UAT-01 | 管理员 | 完成核心配置 | Playwright | PASS/FAIL | screenshots/network/trace |

## 8. 真正可用验证
- real_usability: PASS/FAIL/PARTIAL
- persistence_proof: {创建数据 + 查询数据 + DB/存储证据摘要}
- restart_survival_proof: {重启命令 + 重启后查询同一数据}
- auth_proof: {登录成功 + 越权拒绝}
- cross_service_proof: {前端/HTTP → API → DB/存储链路证据}
- uat_execution_proof: {P0 UAT 编号 + 证据路径}

## 9. 生产级验收验证
- production_acceptance: PASS/FAIL/PARTIAL
- business_closure: {真实角色 + P0 工作流 + 最终业务结果}
- data_closure: {创建/处理/查询/导出/回溯/重启保留证据}
- permission_closure: {登录/授权/越权拒绝/审计日志}
- state_closure: {处理中/成功/失败/部分失败/取消/返工状态证据}
- exception_closure: {失败/重试/部分失败/重复提交/并发冲突恢复证据}
- ux_closure: {下一步/成功结果/失败原因/修正入口截图}
- integration_closure: {前端/API→后端→DB/对象存储/队列/外部服务 trace}
- ops_closure: {日志/trace/request id/回滚/备份/数据修复路径}
- performance_closure: {目标数据量/并发量/任务量 smoke 结果}
- evidence_closure: {截图/network/log/trace/DB/导出文件证据路径}

## 10. 诊断记录（有失败时必须）
### 失败1: {端点} {错误描述}
| 假设 | 验证 | 结果 |
|------|------|------|
| 端口配置错误 | grep port → 3002 | ❌ 排除 |
| 进程崩溃 | 前台启动 → 看日志 | ✅ 确认: EADDRINUSE |
| 端口占用 | ss -tlnp → pid 1234 | ✅ 确认: 旧进程残留 |
| 解决方案 | kill 1234 && 重启 | ✅ 恢复 |
- **根因**: 端口被旧进程占用
- **解决**: kill 旧进程 + 等待 2s 后重启成功

## 11. 结论
DEPLOY_PASS / DEPLOY_FAIL / DEPLOY_PARTIAL
```

---

## Phase 5.8: 穷尽式生产场景自动跑（P0-X Round 2）

> **位置**: 插在 Phase 5.6 (漫游) 之后, Phase 6 (后端 E2E) 之前. 跟 Phase 5.7 (灾难演练) 平行.
> **角色**: 跟 Phase 5 互补 — Phase 5 验证"已实现代码跑得对", Phase 5.8 验证"跟生产一致的真实账号/数据/跨服务跑得对".
> **触发条件**: `.shadow/L2-e2e/{slug}/production-scenarios/prod.config.json` 存在.

### 5.8.1 前置 env 校验

L6 walker 必须在跑 Playwright 前确保以下 env 已设 (L2 prod.config.json.production_contract.real_accounts.required=true 时):

| 变量 | 必填 | 来源 |
|------|------|------|
| `E2E_USER_ENGINEER` | fullstack/frontend 必填 | secrets manager / `~/.config/shadow/secrets.env` |
| `E2E_USER_RESEARCHER` | fullstack 必填 | 同上 |
| `E2E_PASSWORD` | 必填 | 同上 (env-only, 永不进 git) |
| `E2E_TENANT_ID` | 必填 | 真实租户 ID |
| `E2E_BASE_URL` | 必填 | 前端入口 URL |
| `E2E_DB_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_NAME` | fullstack 必填 | docker compose service |
| `E2E_REDIS_HOST` / `_PORT` | fullstack 必填 | 事件总线 |
| `E2E_ALLOW_CHAOS` | 选填 (0/1) | 是否允许真实故障注入 |
| `E2E_ALLOW_RESTART` | 选填 (0/1) | 是否允许真实重启 backend |

**任一必填缺 → exit 2 → 部署报告 `production_scenarios: FAIL` → 不写 marker → R11 必 fail**.

### 5.8.2 执行命令

```bash
bash skills/shadow-l6-deploy/scripts/run-production-scenarios.sh {slug}
```

脚本会:
1. 验证 `prod.config.json` 存在
2. 验证 env (缺则 exit 2)
3. pre-flight `npx playwright --version` (缺则 exit 2)
4. 算 `sha256(prod.config.json)` 写入 `prod-evidence/prod-config-hash.txt`
5. `cd production-scenarios/ && npx playwright test --grep @P0 --reporter=json,html,list --output=$EVIDENCE_DIR/playwright-output --trace=on --video=retain-on-failure --screenshot=on`
6. 解析 `playwright-output/results.json` 写 `summary.json` (passed/failed/flaky/total_ms)
7. exit 0 → 写 `smoke-test-passed` marker (含 `production-scenarios @production: N passed | prod-config-hash=...`); exit 1/2/3 → 不写 marker
8. `chmod 444 marker; chmod -R 444 prod-evidence/` (R3 联动)

### 5.8.3 退出码契约

| 退出码 | 含义 | 修复路径 |
|--------|------|----------|
| 0 | 所有 @P0 spec 通过 | — |
| 1 | Playwright 测试失败 | 查 `prod-evidence/playwright.log` + `playwright-output/test-results/`, 修代码或修 spec |
| 2 | 契约违反 (缺 config / 缺 env / npx 不可用) | L2 阶段补 `prod.config.json` / 补 env / `npm install -D @playwright/test && npx playwright install --with-deps chromium` |
| 3 | Spec 存在但 selector 不存在 (前端未实现) | 派 L5-impl 修 selector, 别改 prod.config.json |

### 5.8.4 evidence 落点 (R3 evidence_archive 联动)

`.shadow/iterations/iter-N/L6-deploy/{slug}/prod-evidence/`:

```
prod-evidence/
  playwright.log                  # 完整 stdout (tee)
  playwright-output/
    results.json                  # Playwright JSON 报告
  test-results/                   # Playwright 内置 (含 trace.zip, video.webm, screenshots)
  html-report/                    # Playwright HTML
  summary.json                    # {"passed", "failed", "flaky", "total_ms", "exit_code", "prod_config_hash", "project_type", "scale"}
  prod-config-hash.txt            # sha256(prod.config.json at run time), 防 marker 复用
```

### 5.8.5 R11 Round 2 4 层验证 (gate-check-lifecycle.sh:307 升级)

R11 消费本 phase 产出的 marker, 4 层全部通过才 PASS:

| 层 | 验证 | 失败处置 |
|----|------|----------|
| L1 | marker 存在 + mtime < 7 天 | FAIL (stale) |
| L2 | 首行正则 `production-scenarios @production: [0-9]+ passed` | FAIL (Round 1 旧 marker, 提示重跑 Phase 5.8) |
| L3 | `prod-evidence/summary.json.failed == 0` + `playwright.log` 末行有 `passed` | FAIL (测试失败, 看 playwright.log) |
| L4 | marker 中 `prod-config-hash=...` == `prod-evidence/prod-config-hash.txt` (sha256 匹配) | FAIL (marker 复用, 看 L3 evidence 跟 L4 hash 是否同次跑) |

新项目 (`.shadow/LIFECYCLE.md` 存在) 任一层 fail → `exit 1` 硬阻断.
老项目 (`.shadow/LIFECYCLE.md` 缺席) → 走 Round 1 advisory (软警告, exit 0), 行为不变.

### 5.8.6 跟 8 维穷举的关系

Phase 5.8 只跑 `@P0` (避免 R11 suite 超时), P1 走 nightly.
P0 spec 必须覆盖 8 维中至少 4 个 (L 规模, 见 `skills/shadow-l2-e2e/references/production-scenario-contract.md` §2):

| 维度 | P0 spec 文件名模式 | 跑通后断言 |
|------|-------------------|------------|
| 1. Rules | `P0_main_*.spec.ts` | RXX 行为 + DB 状态 |
| 2-3. Pages/Interactions | (合并到 P0_main_*) | page selector 命中 |
| 4. Roles | `P0_auth_*.spec.ts` | 真实账号 + 越权 403 + audit log |
| 5. Data scale | `P0_persistence_*.spec.ts` | assertMinRecords + restart survival |
| 6. Cross-service | `P0_cross_bxx_*.spec.ts` | eventSeen + 跨 BXX DB 可见 |
| 7-8. Error/Chaos | `F_*.spec.ts` / `C_*.spec.ts` | 503/400/403 状态码 + 浏览器降级提示 |

### 5.8.7 已知陷阱

| 陷阱 | 处置 |
|------|------|
| cjxdd 已有 pytest-style marker (1 处) | 重跑 Phase 5.8 覆盖, 旧 marker 自动失效 (L2 fail) |
| npx playwright 没装 | pre-flight 友好报错, 引导 `npm install -D @playwright/test && npx playwright install --with-deps chromium` |
| GFW 阻断 chromium download | 引用 docker-helper 镜像源探测 (见 CLAUDE.md "Docker 镜像源自动探测" 段) |
| 大项目 P0 suite 超时 (10+ min) | 只跑 `@P0`, P1 走 nightly; R11 不重试 flaky |
| 真实账号泄密 | env 传递, marker 内容里 email 局部打码 (`xxxx****@***`), 不存明文密码到任何落盘文件 |
| SSR-only 项目 | `real_accounts.required=false` + 注明 rationale, 其余维度照跑 |
| API-only 项目 | spec 改用 `request` fixture (`@playwright/test` 1.16+ 原生), 不截屏/录屏, 但 trace.zip + summary.json 保留 |

## Phase 9: 层内自检（L6 Gate）详细检查项

### 结构性检查
1. deployment-report.md 存在 → 否则直接 FAIL
2. 报告包含 7 个章节（环境基线/启动配置/服务启动/API验证/诊断记录/E2E验证/结论）→ 缺章节 FAIL

### 诊断质量检查（有失败时必须）
3. **每个失败有 ≥3 种假设验证记录** → 只有1-2种假设的，标记为"诊断不充分，要求补充"
4. **没有"网络问题""环境问题""沙箱限制"等无证据归因** → 出现这些词且无证据链的，**自动 FAIL**
5. **所有临时修复有记录** → 改过端口/加过依赖/kill 过进程，必须写进报告
6. **根因分析到位** → 不只是"端口被占"，而是"旧 node 进程残留 pid=1234，kill 后重启成功"
7. **证据链完整** → curl 输出、ss 输出、ps 输出、日志片段，至少有一种贴在报告中

### 功能性检查
8. 启动配置完整（含依赖安装）
9. 健康检查通过（HTTP 200 或预期响应）
10. 关键API端点验证通过
11. L2 e2e场景至少验证核心场景
12. `uat-script.md` 存在，且部署报告逐条引用 UAT 剧本
13. P0 UAT 剧本 100% PASS；否则最终验收 FAIL
14. UAT 证据包存在，至少包含截图/网络请求/最终数据状态证据
15. 前端验收必须有截图：使用 `playwright-cli screenshot` 对每个前端页面/UAT 场景截取起始页、关键操作页、最终结果页截图；纯后端/API 无前端界面的项目可豁免
16. 真正可用验证章节存在，且 `real_usability: PASS`
17. 持久化证据存在：创建数据、查询数据、DB/存储证据闭合
18. 重启保留证据存在：服务重启后同一业务数据仍可查询
19. 认证证据存在：真实登录成功，越权访问被拒绝
20. 跨服务证据存在：前端/HTTP → API → DB/存储链路闭合
21. 生产级验收章节存在，且 `production_acceptance: PASS`
22. 漫游测试章节存在（有前端时）
23. 漫游页面地图完整 — 所有导航入口可达的页面都被访问（≥ 3 层深度）
24. 漫游截图证据存在 — wander-evidence/screenshots/ 包含每个页面的截图
25. 漫游错误证据充分 — console-errors.json 和 network-errors.json 存在
26. 漫游 P0 问题有根因+修复建议
27. 漫游无偷懒 — "漫游发现无明显问题"但没有页面地图/截图 = 打回
28. 漫游 issues.json 存在且完整
29. 漫游设计层回退标注 — trace_to_design 字段对设计层缺失问题不为空
