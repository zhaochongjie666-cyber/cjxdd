---
name: xdd-verify
description: |
  xdd 代码层 —— 真实验证。穷尽式诊断应用可部署/可启动/可测试（后端+前端），证明代码真做到了设计说的。
  禁偷懒归因（网络/环境问题必须有证据链），失败必穷举 ≥3 假设逐个验证。
  最终满足真实可用契约（真实持久化/认证/跨服务链路/重启数据保留）+ 生产接受契约（真实用户愿在真实工作中依赖）。
  含全链路一致性审计（spec↔code / wire↔code / architecture↔code / resilience↔code + 追踪矩阵完整性）+ 漫游测试 + 混沌演练。
  触发：验证、verify、部署、启动、验收、smoke、漫游、wander、真实可用、交付前检查、上线前。
---

# xdd-verify — 代码层验证

## 我锚定什么 / 上游 / 下游

**我证明代码真做到了** —— 不是"测试通过了"，是"用户能用"。穷尽验证可部署/可启动/可测试，禁偷懒归因，禁"基本完成"。

| | |
|---|---|
| **上游** | `xdd-execute`（代码 + 测试）+ 冻结 `qa-plan.md` + 全部设计层锚：spec/architecture/wire/resilience |
| **我产出** | 验证报告（health-check + wander-test + 全链路一致性审计 + chaos-drill + 双契约）|
| **回溯锚** | 验证对照 spec 的每条 RXX 是否真落进代码、对照 architecture 的端点是否真起来 |

## 核心纪律（禁偷懒）

1. **禁偷懒归因** —— 说"网络问题""环境问题"必须有证据链（curl 输出 / docker logs / 端口探测）。没证据链的归因 = 偷懒。
2. **测试环境必须自愈** —— 缺依赖、缺浏览器、DB/服务没启动、端口错、环境变量空，不是停下来的理由；先安装/启动/配置/迁移/改用 docker compose，至少尝试 3 条可执行路径并留证据。
3. **失败穷举 ≥3 假设** —— 一个现象至少列 3 个可能原因，逐个验证排除，不能上来就锁一个。
4. **能用 ≠ 测试通过** —— "测试通过"不是"代码对"。要运行证据（curl/截图/数据查询），不是 GREEN 数。
5. **QA 契约逐项兑现** —— qa-plan.md 每个适用 QA-XXX 必须在 verify-report.md 同行记录 `PASS`/`✅` 与证据路径；不适用项沿用冻结理由，不得在 verify 临时改口。
6. **攻击正向和兜底** —— verify 必须攻击 happy path 与失败/降级/权限/异常路径；只测正向不算验收，只看兜底文档不算兜底。
7. **不报假完成** —— 没跑通就直说没跑通，不写"基本完成""DEPLOY_PASS 蒙混"。
8. **运行时攻击（适用时）** —— 有可部署 runtime 才用 `xdd_runtime_observe` 保存基线并攻击当前 HEAD；库/CLI 等没有可观测 runtime 时软跳过，不能伪造指标。P1 回归必须回炉，P2 保留软告警。
9. **质量评分** —— 调用 `xdd_quality_score` 聚合重复率、escaped defects、MTTR、override 和证据覆盖；评分负责解释优先级，不形成第二个无限硬 Gate。
10. **最终聚合裁决** —— 调用 `xdd_release_decision`；它会兼容性地刷新 Quality Score，再聚合冻结 QA、Code/Commit Review、Blind Journey、verify evidence、runtime、HEAD tree 和干净工作区。只有 `release-decision.json` verdict=release 才能最终推进。


## 正向和兜底攻击检查

verify 的攻击不是只找 bug，而是用证据逼项目完成：

1. **正向攻击**：先枚举全部 `.feature`，逐个（不是抽样）执行每条 Scenario/Scenario Outline 的公开入口验收测试，再对核心 RXX / P0 用户旅程执行真实 happy path，从入口（UI/API）到持久化结果逐步断言；禁止只测 `/healthz` 或只跑 mock 单测。
2. **兜底攻击**：对每条拒绝/异常/无权限/依赖失败/超限/并发/恢复场景执行真实攻击，证明系统会拦截、降级、提示、恢复或保留数据。
3. **双向缺口都回炉**：正向不通回 execute/architecture/wire 修；兜底缺失回 resilience/spec/execute 修；环境缺失按自愈协议先修环境再重跑。
4. **再攻击检查**：每次回炉后必须重跑对应攻击，不允许“已修代码”替代“攻击证据通过”。

验证报告必须分开列出“正向证据”和“兜底攻击证据”；任一为空，结论不能 PASS。

## 验证环境自愈协议（不能因环境缺失中断）

当测试/启动失败的直接现象是“工具未安装、服务未运行、端口不对、数据库不可达、浏览器缺失、环境变量为空”时，默认判定为 **验证环境待修复**，不是“无法验证”。必须按下面顺序自愈，直到拿到可执行验证结果或形成完整阻塞证据链：

1. **识别项目事实**：读取 `README`、`package.json`、`pyproject.toml`、`requirements*.txt`、`Dockerfile`、`docker-compose*.yml`、`Makefile`、`pytest.ini` 等，找官方安装/测试/启动命令。
2. **安装缺失依赖**：能联网就执行项目推荐命令（如 `npm install`、`pip install -r requirements.txt`、`python -m playwright install --with-deps`）；禁止只说“未安装”。
3. **拉起基础设施**：优先 `docker compose up -d --wait`；若 compose 不存在，再用本地服务或轻量替代（如 SQLite/test DB）并明确差异。
4. **启动被测服务**：根据项目入口启动后探测端口（`ss -tlnp` / `curl /healthz`），端口冲突就换端口或停掉无关进程，并记录选择。
5. **重跑验证命令**：依赖装好、服务起来后，必须重跑原失败命令；不能停在“环境已修”。
6. **降级但不断证据**：浏览器 E2E 跑不起来时，先修 Playwright/浏览器；仍失败时用 `curl`/HTML 快照/API 漫游替代，报告里标明降级范围，但不得把降级当 PASS。
7. **阻塞门槛**：只有连续尝试 ≥3 条路径（例如本机安装、docker compose、最小替代服务）且每条都有命令输出，才允许写“环境阻塞”。阻塞报告必须包含下一步精确命令，而不是让用户猜。

**典型场景**：Playwright E2E 因 `ModuleNotFoundError`、服务未监听、`DATABASE_URL` 为空而收集 0 tests 时，正确动作是安装 Playwright 与浏览器、启动/配置 DB、启动应用服务、再次 collect/run；错误动作是直接回答“当前环境无法执行”。

## 怎么做

### 1. 健康检查（health-check）

服务真能起来：

```
docker compose up -d --wait          # 每个服务 healthcheck 过
curl -sf http://localhost:<port>/healthz   # 200 + 响应体
docker compose ps                    # 所有服务 Up (healthy)
```

每个 API 端点（对照 architecture 端点清单）至少 curl 一次，确认路由通、返回结构对。

### 2. 漫游测试（wander-test）

像真实用户一样走完关键路径，每步留运行证据：

```
□ 注册 → 登录 → 拿 token（curl，贴响应）
□ 用 token 做核心操作（POST → 拿 ID → GET → 改 → DELETE）
□ 数据落库（直接查 DB，SELECT 看到记录）
□ 重启服务 → 数据还在（docker compose restart → 再查）
□ 前端页面打开（每个 wire 页面渲染正常，无白屏）
□ 权限对（每个角色只能做自己的事，越权被拒）
```

用 `scripts/wander-test.sh` 跑可脚本化的链路，手工补 UI 部分。

### 3. 全链路一致性审计（代码真跟设计对齐 + 链路不断裂）

> **漫游怎么走、全链路怎么查、双契约怎么判通过 → 查 `references/verification-methods.md`**（验证方法论：漫游覆盖/全链路 grep 对照/双契约证据/禁偷懒归因）。

对照设计层 4 个锚，反向验证代码没跑偏：

| 维度 | 对照 | 查什么 |
|------|------|--------|
| **spec ↔ code** | `spec/{bxx-slug}/rules.md` RXX | 每条 RXX 有代码 `@implements RXX` + 测试？grep `@implements` 数 ≥ RXX 数 |
| **Feature ↔ task ↔ code ↔ test** | `spec/{bxx-slug}/*.feature` 全部 Scenario/Outline | 每个场景在 plan 同一 task 有精确 `Feature` 锚、生产 `Implementation`、可运行 `Acceptance Test` 和 PASS Evidence；集合差必须为空 |
| **wire ↔ code** | `wire/{page}.md` | 每个页面真渲染了？每个操作态（空/加载/错误/成功/确认）都实现？ |
| **architecture ↔ code** | `architecture/{bxx-slug}/architecture.md` 端点清单 | 端点清单的每个端点都实现了？grep `@app.get/post` 数 = 清单数（别 60→23）|
| **resilience ↔ code** | `resilience/failsafe-design.md` 兜底 | 每个兜底策略在代码里有实现位置？ |

不一致 → 回 execute 补，或回设计层修。

### 4. 混沌演练（chaos-drill）

跑 `resilience/chaos-scenarios.md` 的 P0 子集，验兜底真生效（用 `xdd-resilience/scripts/chaos-runner.sh`）：

```
□ 注入网络分区 → 熔断触发 + 降级 + UI 提示
□ 撤销注入 → 自动恢复 + 草稿 sync
□ 进程崩溃 → 重启恢复 + 数据不丢
```

每个注入有具体命令（iptables/docker pause/kill），有 before/after 状态证据。

### 5. 存根扫描（反 sham 最后防线）

```bash
bash skills/xdd-execute/scripts/no-stub-check.sh .
# 全项目零存根/零假实现
```

## 双契约（最终必须满足）

### 真实可用契约（Real Usability）

```
□ 真实持久化：写 → 查 → 重启后还在（不是 mock DB）
□ 真实认证：JWT/Session 真校验，未登录被拒（不是硬编码 current_user）
□ 跨服务链路：事件 producer → queue → consumer → DB 真跑通
□ 重启数据保留：docker compose down → up → 数据还在
□ P0 用户旅程证据：核心路径有 curl/截图/数据查询证据
```

### 生产接受契约（Production Acceptance）

```
□ 真实用户愿在真实工作中依赖这个（不是 demo 玩具）
□ 错误有用户语言说明（不是裸错误码）
□ 边界情况有处理（空/超限/重复/并发）
□ 无明显安全漏洞（认证/授权/输入校验/SQL 注入）
```

## 失败处理（3 轮硬上限）

```
# 起点：本 skill 产出的验证报告里的失败项（按 P0/P1/P2 优先级）
# 终点：每轮修完重跑「健康检查 + 漫游测试」（见 §1/§2），直到无 P0/P1
for round in 1..3:
  if round == 1: 修报告里的 P0 + P1（改代码）→ 重跑健康检查+漫游
  elif round == 2: 修剩余 P1 + P2 → 重跑
  elif round == 3:
    if 仍有 P1:                       # 修不动 = 找根因
      rollback(根因):                 # 判定见括号
        实现缺陷（代码 bug / 端点缺失 / 测试失败）-> xdd-execute（主动返回修复后重跑 verify）
        规则没写清（spec RXX 含糊/冲突）  → xdd-spec
        空状态/页面缺（wire/{page}.md 缺该状态）→ xdd-wire
        工作流卡点（design.md 该决策缺失）  → xdd-brainstorm
        API/事件错（architecture.md 没覆盖）→ xdd-architecture
        兜底不够/错（resilience/ 没覆盖该失败模式）→ xdd-resilience
      → 沿 propagate 往下重做 → 回到 verify 重跑
# 3 轮仍有 P1 → 写 runs/xdd_run/failure-log.md，停下问用户
```

> **关键**：实现缺陷（代码 bug / 端点缺失 / 测试失败）直接 rollback 到 `execute`，
> 不要问用户。调 `xdd_rollback("execute", "verify 验证失败，主动返回 execute 修复后重跑")`。

## 漫游修复卡住怎么办

同一 P1 连续 3 试没修好 → 不硬扛，回设计层找根因（跟 execute 的 3 试 HALT 一致）。

## 产出

`.xdd/runs/xdd_run/verify-report.md`（验证报告）+ `runs/xdd_run/evidence/`（截图/快照/响应）。Gate 校验 verify-report.md 存在（min 100 字节）。

```markdown
## 验证报告
### 健康检查
[docker compose ps + curl /healthz 输出]
### 漫游测试
每关键路径的证据（截图 + 结构化快照 + curl 响应体），存 `runs/xdd_run/evidence/`：
- 首页截图: `evidence/screenshots/home.png`（playwright-cli 整页渲染）；结构化快照: `evidence/snapshots/home.yaml`（可访问性树 + 元素 ref）
- 降级（无 playwright-cli）: `evidence/responses/home.html`（curl HTML 快照）
- 端点 `/api/xxx`: `evidence/responses/api-xxx.html` · HTTP {code}
- 内联关键证据（截图直贴报告）：`![](evidence/screenshots/home.png)`
### 全链路一致性审计
| 维度 | 设计数 | 代码数 | 一致? |
| spec RXX | N | grep @implements M | ✅/❌ |
| 端点 | N | M | ✅/❌ |
### 混沌演练
[P0 场景 before/after 证据]
### 存根扫描
[no-stub-check.sh 输出: 零命中]
### 双契约
□ 真实可用契约 [逐项 ✅/❌ + 证据]
□ 生产接受契约 [逐项 ✅/❌]
### 结论
[真能用 / 有 P1 待修 + 回退建议]
```

## 自检

```
□ health-check：所有服务 healthy + /healthz 200？
□ 漫游：核心路径每步有运行证据（非"测试通过"）？
□ 漫游证据已存 `evidence/`（截图 `screenshots/*.png` + 结构化快照 `snapshots/*.yaml`，或降级 `responses/*.html`），报告引用了路径？
□ 全链路一致性：spec/wire/architecture/resilience 跟代码对齐？
□ 追踪矩阵完整：每个 AC-XX 有架构+代码+测试，每个 BR 有测试，无幽灵代码？
□ 四层测试覆盖：领域/应用服务/Repository集成/Feature验收都有？
□ Feature 验收测试通过公开 API 调用（不绕过应用层直接改 DB）？
□ 已逐文件点遍所有 Scenario/Scenario Outline，且 `Feature 场景集合 - 已通过验收测试集合 = ∅`（不是只抽核心场景）？
□ 代码级质量：领域规则不住Controller？DB负责并发？审计append-only？通知不破坏主事务？身份来自认证上下文？
□ design 契约「实现/实施」列 checkbox 与代码 `@implements RXX` 一致（无幽灵勾/漏勾）？
□ 混沌：P0 场景兜底真生效，有 before/after 证据？
□ 存根扫描：no-stub-check.sh 全项目零命中？
□ 真实持久化：重启后数据还在？
□ 跨服务链路：producer→queue→consumer→DB 真跑通？
□ 失败归因都有证据链（无"网络问题"空话）？
□ 失败穷举了 ≥3 假设？
□ 双契约逐项有 ✅ + 证据，没假完成？
```
