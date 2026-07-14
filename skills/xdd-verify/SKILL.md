---
name: xdd-verify
description: |
  xdd 代码层 —— 真实验证。穷尽式诊断应用可部署/可启动/可测试（后端+前端），证明代码真做到了设计说的。
  禁偷懒归因（网络/环境问题必须有证据链），失败必穷举 ≥3 假设逐个验证。
  最终满足真实可用契约（真实持久化/认证/跨服务链路/重启数据保留）+ 生产接受契约（真实用户愿在真实工作中依赖）。
  含 4 维一致性审计（spec↔code / wire↔code / architecture↔code / resilience↔code）+ 漫游测试 + 混沌演练。
  吸收旧 xdd-l6 + xdd-scaffold(smoke) + xdd-design-review(一致性)。
  触发：验证、verify、部署、启动、验收、smoke、漫游、wander、真实可用、交付前检查、上线前。
---

# xdd-verify — 代码层验证

## 我锚定什么 / 上游 / 下游

**我证明代码真做到了** —— 不是"测试通过了"，是"用户能用"。穷尽验证可部署/可启动/可测试，禁偷懒归因，禁"基本完成"。

| | |
|---|---|
| **上游** | `xdd-execute`（代码 + 测试）+ 全部设计层锚：`xdd-spec`（RXX）、`xdd-architecture`（端点/结构）、`xdd-wire`（页面）、`xdd-resilience`（兜底） |
| **我产出** | 验证报告（health-check + wander-test + 4 维一致性审计 + chaos-drill + 双契约）|
| **回溯锚** | 验证对照 spec 的每条 RXX 是否真落进代码、对照 architecture 的端点是否真起来 |

## 核心纪律（禁偷懒）

1. **禁偷懒归因** —— 说"网络问题""环境问题"必须有证据链（curl 输出 / docker logs / 端口探测）。没证据链的归因 = 偷懒。
2. **失败穷举 ≥3 假设** —— 一个现象至少列 3 个可能原因，逐个验证排除，不能上来就锁一个。
3. **能用 ≠ 测试通过** —— "测试通过"不是"代码对"。要运行证据（curl/截图/数据查询），不是 GREEN 数。
4. **不报假完成** —— 没跑通就直说没跑通，不写"基本完成""DEPLOY_PASS 蒙混"。

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

### 3. 4 维一致性审计（代码真跟设计对齐）

> **漫游怎么走、4 维怎么查、双契约怎么判通过 → 查 `references/verification-methods.md`**（验证方法论：漫游覆盖/4 维 grep 对照/双契约证据/禁偷懒归因）。

对照设计层 4 个锚，反向验证代码没跑偏：

| 维度 | 对照 | 查什么 |
|------|------|--------|
| **spec ↔ code** | `spec/{bxx-slug}/rules.md` RXX | 每条 RXX 有代码 `@implements RXX` + 测试？grep `@implements` 数 ≥ RXX 数 |
| **wire ↔ code** | `wire/{page}/` | 每个页面真渲染了？每个操作态（空/加载/错误/成功/确认）都实现？ |
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
    if 仍有 P1:                       # 代码层修不动 = 根因在设计层
      rollback(根因):                 # 判定见括号
        规则没写清（spec RXX 含糊/冲突）  → xdd-spec
        空状态/页面缺（wire/{page}/ 缺该状态）→ xdd-wire
        工作流卡点（design.md 该决策缺失）  → xdd-brainstorm
        API/事件错（architecture.md 没覆盖）→ xdd-architecture
        兜底不够/错（resilience/ 没覆盖该失败模式）→ xdd-resilience
      → 沿 propagate 往下重做 → 回到 verify 重跑
# 3 轮仍有 P1 → 写 runs/iter-N/failure-log.md，停下问用户
```

## 漫游修复卡住怎么办

同一 P1 连续 3 试没修好 → 不硬扛，回设计层找根因（跟 execute 的 3 试 HALT 一致）。

## 产出

`.xdd/runs/iter-N/verify-report.md`（验证报告）+ `runs/iter-N/evidence/`（截图/快照/响应）。Gate 校验 verify-report.md 存在（min 100 字节）。

```markdown
## 验证报告
### 健康检查
[docker compose ps + curl /healthz 输出]
### 漫游测试
每关键路径的证据（截图 + 结构化快照 + curl 响应体），存 `runs/iter-N/evidence/`：
- 首页截图: `evidence/screenshots/home.png`（playwright-cli 整页渲染）；结构化快照: `evidence/snapshots/home.yaml`（可访问性树 + 元素 ref）
- 降级（无 playwright-cli）: `evidence/responses/home.html`（curl HTML 快照）
- 端点 `/api/xxx`: `evidence/responses/api-xxx.html` · HTTP {code}
- 内联关键证据（截图直贴报告）：`![](evidence/screenshots/home.png)`
### 4 维一致性审计
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
□ 4 维一致性：spec/wire/architecture/resilience 跟代码对齐？
□ design 契约「实现/实施」列 checkbox 与代码 `@implements RXX` 一致（无幽灵勾/漏勾）？
□ 混沌：P0 场景兜底真生效，有 before/after 证据？
□ 存根扫描：no-stub-check.sh 全项目零命中？
□ 真实持久化：重启后数据还在？
□ 跨服务链路：producer→queue→consumer→DB 真跑通？
□ 失败归因都有证据链（无"网络问题"空话）？
□ 失败穷举了 ≥3 假设？
□ 双契约逐项有 ✅ + 证据，没假完成？
```
