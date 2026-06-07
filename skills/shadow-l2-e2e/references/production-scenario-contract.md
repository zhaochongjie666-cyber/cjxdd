# Production Scenario Contract — 生产场景契约

> 引用 .shadow/L2-e2e/{slug}/production-scenarios/prod.config.json 的强制条款。
> 是 L2 设计期 + L5 填实 + L6 自动跑 + R11 硬门禁的共同验收口径。

## 1. 目标

"穷尽式生产场景" 不是写 1 个 happy-path 测试, 而是按 8 维度穷举, 强制使用 **真实账号 + 真实生产数据规模 + 真实跨服务链路**, 让 AI coder 不能用 mock 蒙混过关, 让部署验证不能"测过即用"。

适用:
- L2 设计期: Walker 写 `prod.config.json` + 八面穷举矩阵 + P0 spec 骨架
- L5 填实期: AI coder 读 prod.config.json 强约束, 移除所有 `test.skip` 防护, 接通真实 selector
- L6 部署期: Phase 5.8 自动跑 `npx playwright test --grep @production`, evidence 落 `prod-evidence/`, marker 写 `smoke-test-passed`
- R11 门禁: 4 层验证 (mtime + 内容 + evidence + hash), 新项目硬阻断

不适用的项目:
- 纯 API 无前端: 改用 `request` fixture, 不截屏/录屏, 但 trace.zip + summary.json 保留
- SSR-only 无后端 API: `real_accounts.required=false` + 注明 rationale, 其余维度照跑
- 纯静态 demo (无后端无 DB): 整个 production-scenarios 套件不适用, 在 `scale.md` 设 `production_scenarios: off` 推迟

## 2. 8 维穷举矩阵 (硬要求)

| # | 维度 | 数据来源 | L 规模最低 | M 规模最低 | S 规模最低 | 不达标后果 |
|---|------|---------|-----------|-----------|-----------|----------|
| 1 | **Rules (RXX)** | `spec.md` regex `${SLUG}-R[0-9]+` | P0 100%, P1 ≥ 80% | P0 100%, P1 ≥ 60% | P0 100% | L2 check-e2e FAIL |
| 2 | **Pages (data-page)** | `wire.svg` `data-page=` | 100% 出现 | 100% P0 路径 | 100% P0 路径 | L2 check-e2e FAIL |
| 3 | **Interactions (data-action)** | `wire.svg` `data-action=` | 100% P0 路径 | 100% P0 路径 | 100% P0 路径 | L2 check-e2e WARN |
| 4 | **Roles** | `research.md` 画像 + L2 6 维发散 | 每个 core role ≥ 1 spec | 同 | 同 | L2 check-e2e FAIL |
| 5 | **Data scale** | `intent.md` 性能指标 | ≥ 100 records + ≥ 50MB 资产 | ≥ 30 records | ≥ 10 records | L6 Phase 5.8 FAIL |
| 6 | **Cross-service** | `architecture.md` API 端点 + `event-contract.md` 订阅 | ≥ 2 services, ≥ 1 cross-BXX | ≥ 1 service | ≥ 1 service | L6 Phase 5.8 FAIL |
| 7 | **Error states** | L3 `failure-modes.md` P0 | 每个 P0 failure-mode 1 spec | 同 | 同 | L2 check-e2e FAIL |
| 8 | **Real-world chaos** | L3 `chaos-scenarios.md` @chaos P0 | 每个 P0 chaos 1 spec (L6 Phase 5.7 重复亦可) | 同 | 同 | L2 check-e2e FAIL |

**S/M 规模降级**: 在 `prod.config.json.production_contract.data_scale.min_records` 字段直接填实际值, L2 walker 读后填入八面穷举矩阵当前值列. L2 check-e2e.sh 不硬约束数值, 只验证"字段已填 + 真实数据确实被引用".

## 3. 跟生产一致 (生产行为合规)

### 3.1 真实账号 (real_accounts.required)

**必须**:
- 通过 env 传递 (`E2E_USER_ENGINEER` / `E2E_USER_RESEARCHER` / `E2E_PASSWORD` / `E2E_TENANT_ID`)
- L6 runner 在跑 Playwright 前 env-check, 缺则 exit 2
- 账号从 secrets manager / CI 变量 / `~/.config/shadow/secrets.env` 拉, 永不进 git

**禁止**:
- `fixtures/accounts.json` 存真实密码 (只允许 `accounts.example.json` 模板)
- 测试代码里 `current_user = 'admin'` 或 `email = 'test@test.com'`
- 用 `MockUser` / `FakeAuth` / `InMemoryUserRepository`

### 3.2 真实数据规模 (data_scale.min_records)

**必须**:
- spec 内用 `assertMinRecords(table, tenantColumn, tenantId, min)` 强制断言
- 数据从 docker compose 启动时的 init.sql / seed 脚本灌入, 不用 fixture.js 临时写
- 资产 (3D 模型 / 视频 / 文档) 从 MinIO / S3 真实对象存储拉, 不用 test-only 路径

**禁止**:
- spec 里写 `await dbQuery('INSERT ...')` 临时插数据 (那不是生产数据)
- 用 `faker.js` 生成假数据
- 用 `InMemoryRepository` 充当数据源

### 3.3 真实跨服务 (cross_service.min_services)

**必须**:
- spec 至少触发 2 个服务的 API 调用 (例如 B01 API → B03 API)
- 跨服务通过事件总线 (Redis Streams / Kafka) 而非直接 HTTP
- 跨服务断言用 DB query (验证事件被下游消费), 不用 mock listener

**禁止**:
- 跨服务测试用 `fetch` 直接调下游服务 (绕过事件总线 = 绕开兜底机制)
- 用 `MockEventBus` 替代真实事件总线
- 跳过下游服务, 只验证上游"事件已发布" (那不是真实跨服务)

### 3.4 无 mock (no_mocks_in_p0)

**禁止模式** (grep 检测, 命中 → L6 Phase 5.8 失败):
- `InMemoryRepository`
- `MockDB` / `FakeDB` / `TestDB`
- `fake-login` / `test-only-tenant`
- `current_user\\s*=\\s*['"]admin['"]` (硬编码 admin)
- `await new Promise(r => setTimeout(r, ...))` 替代真实等待 (假装异步完成)

**豁免** (允许但需在 spec 注释):
- `test.skip(...)` 防护真实环境差异 (例如 GPU OOM 注入需 `E2E_ALLOW_CHAOS=1`)
- `request.unroute()` 临时绕开限流
- 调试用的 `console.log` (不参与断言)

## 4. 真实事件 / 持久化断言 (跟"假数据"的区分)

### 4.1 事件断言 (helper/event.ts)

```typescript
// 真: 读 Redis Streams, 等真实事件
const eventId = await eventSeen('SceneAvailable', { timeout: 5000 });

// 假 (禁止): 自己 trigger 后立即断言
await page.click('[data-action="publish"]');
expect(await page.locator('[data-status="PUBLISHED"]').count()).toBe(1);  // 不验证事件链路
```

### 4.2 持久化断言 (helper/db.ts)

```typescript
// 真: 通过 pg 直连生产 DB 查
const rows = await dbQuery('SELECT * FROM scenes WHERE id = $1', [sceneId]);
expect(rows[0].status).toBe('PUBLISHED');

// 假 (禁止): 通过 UI 元素验证
await page.reload();
expect(await page.textContent('[data-status]')).toBe('PUBLISHED');  // 可能是前端缓存
```

### 4.3 重启保留断言 (P0 强制)

```typescript
// 真: 走真实 docker compose restart
execSync('docker compose restart b01-api', { stdio: 'inherit' });
await page.waitForTimeout(10000);
await page.reload();
const after = await dbQuery('SELECT * FROM scenes WHERE id = $1', [sceneId]);
expect(after.length).toBe(1);

// 假 (禁止): mock 重启
test.mock('restart', () => null);  // 假装重启
```

## 5. 8 维穷举 → spec 文件名映射 (L2 walker 工作流)

| 维度 | spec 文件名模式 | 数量 (L 规模) | 数量 (M 规模) | 数量 (S 规模) |
|------|----------------|--------------|--------------|--------------|
| 1. Rules | `P0_main_*.spec.ts` 覆盖各 RXX | 1+ per RXX group | 1+ per RXX group | 1+ per P0 RXX |
| 2. Pages | (合并到 P0_main_*) | (合并) | (合并) | (合并) |
| 3. Interactions | (合并到 P0_main_*) | (合并) | (合并) | (合并) |
| 4. Roles | `P0_auth_*.spec.ts` 每个 role | ≥ 2 role | ≥ 1 role | ≥ 1 role |
| 5. Data scale | `P0_persistence_*.spec.ts` | 1 | 1 | 1 |
| 6. Cross-service | `P0_cross_bxx_*.spec.ts` | ≥ 1 | ≥ 1 | (N/A 警告) |
| 7. Error states | `F_*.spec.ts` @P0 failure-modes | 1 per P0 failure-mode | 同 | 同 |
| 8. Chaos | `C_*.spec.ts` @P0 @chaos | 1 per P0 chaos | 同 | 同 |

**L 规模最小集合**: 4 P0 + 2 F + 2 C = 8 spec 文件 (假设 4 个 RXX 群 + 2 个 P0 failure-mode + 2 个 P0 chaos)
**M 规模最小集合**: 2 P0 + 1 F + 1 C = 4 spec 文件
**S 规模最小集合**: 1 P0 + 1 F = 2 spec 文件

## 6. CI / L6 集成

### 6.1 L6 runner 命令

```bash
# Phase 5.8 自动跑 (跟生产一致)
cd .shadow/L2-e2e/$SLUG/production-scenarios
npx playwright test --grep "@P0" \
    --reporter=json,html \
    --output=playwright-output \
    --trace=on --video=retain-on-failure --screenshot=on
```

### 6.2 环境变量契约

L6 runner 在跑 Playwright 前, 验证以下 env 已设 (缺则 exit 2):

| 变量 | 必填 | 用途 | 示例 |
|------|------|------|------|
| `E2E_USER_ENGINEER` | fullstack/frontend 必填 | Engineer 真实账号 email | `engineer1@vla.demo` |
| `E2E_USER_RESEARCHER` | fullstack 必填 | Researcher 真实账号 email | `researcher1@vla.demo` |
| `E2E_PASSWORD` | 必填 | 真实密码 (env-only) | `<from-secret-store>` |
| `E2E_TENANT_ID` | 必填 | 租户 ID | `tenant-acme` |
| `E2E_BASE_URL` | 必填 | 前端入口 URL | `http://localhost:3000` |
| `E2E_DB_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_NAME` | fullstack 必填 | DB 直连 | `localhost` / `5432` / `app_user` / `***` / `appdb` |
| `E2E_REDIS_HOST` / `_PORT` | fullstack 必填 | 事件总线 | `localhost` / `6379` |
| `E2E_ALLOW_CHAOS` | 选填 | 是否允许真实故障注入 (0/1) | `1` |
| `E2E_ALLOW_RESTART` | 选填 | 是否允许真实重启 backend (0/1) | `1` |

### 6.3 退出码契约

| 退出码 | 含义 | R11 处理 |
|--------|------|----------|
| 0 | 所有 @P0 spec 通过 | 写 marker, 4 层验证 PASS |
| 1 | Playwright 测试失败 | 不写 marker, 留 evidence, R11 FAIL |
| 2 | 契约违反 (缺 config / 缺 env) | 不写 marker, 留 evidence, R11 FAIL |
| 3 | Spec 存在但 selector 不存在 (前端未实现) | 不写 marker, 留 evidence, R11 FAIL (派 L5-impl 修 selector) |

### 6.4 证据契约

`.shadow/iterations/iter-N/L6-deploy/{slug}/prod-evidence/` 必有:
- `playwright.log` — 完整 stdout
- `summary.json` — `{"passed": N, "failed": M, "flaky": K, "total_ms": T}`
- `prod-config-hash.txt` — sha256(prod.config.json at run time), 防 marker 复用
- `playwright-output/` — Playwright 内置 (含 trace.zip, video.webm, screenshots)
- `html-report/` — Playwright HTML 报告

R11 验证层 L3 校验 `summary.json.failed == 0` + `playwright.log` 末行有 `passed`, L4 校验 marker hash = evidence hash.

## 7. 老项目 / 推迟策略

老项目 (无 `.shadow/LIFECYCLE.md`): R11 软警告, 不触发本契约, 行为不变.

新项目暂不启用: 在 `.shadow/scale.md` 加:
```yaml
gate_options:
  production_scenarios: off  # off / warn / hard (default: hard)
```
- `off` — R11 跳过生产场景校验, 跟 Round 1 行为一致
- `warn` — R11 校验但不硬阻断, 仅输出 advisory
- `hard` — R11 硬阻断 (新项目默认)

## 8. 跟其他 5 硬门禁的关系

| 门禁 | 验证对象 | 跟 production scenarios 关系 |
|------|----------|----------------------------|
| R1 设计基线改动传播 | `prod.config.json` 改动触发 L5/L6 重跑 | design_baseline 角色登记 |
| R3 证据写阻断 | `prod-evidence/` chmod 444 防改 | evidence_archive 角色登记 |
| R5 漂移扫描 | schema 登记 `production-scenarios-config` / `-evidence` | 防止路径漂移 |
| R6 路径 locality | `.shadow/L2-e2e/{slug}/production-scenarios/` 必须在 schema 登记 | schema 唯一源真理 |
| R10 自动归档 | iter 冻结时 `prod-evidence/` 跟着 R10 走 | iter 作用域 |
| **R11 真实烟雾测试** | **本契约的核心目标** | 4 层验证硬门禁 |

## 9. 一句话标准

**真实用户拿真实账号, 在真实生产数据规模上, 跑真实跨服务链路, 浏览器操作步骤跟 e2e.md 一致; 任何 spec 失败, R11 硬阻断, 部署报告不得写 DEP3OY_PASS.**
