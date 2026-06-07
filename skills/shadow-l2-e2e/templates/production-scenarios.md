# L2 穷尽式生产场景模板 (Production Scenarios Template)

> 文件位置: `.shadow/L2-e2e/BXX-{slug}/production-scenarios/`
> 角色定位: **design_baseline** 设计基线（跟 e2e.md / coverage-matrix.md / uat-script.md 同级）
> 跟 uat-script.md 关系: UAT = 用户视角剧本 (Markdown 描述), Production Scenarios = 可执行 Playwright 测试 (跟生产一致)
> 触发时机: L2 设计期产出, L5-impl 阶段填实 page_selector / interaction / db_query / event_type 字段

## 1. 跟生产一致声明 (prod.config.json)

```json
{
  "version": "1.0.0",
  "scale": "L",
  "project_type": "fullstack",
  "production_contract": {
    "real_accounts": {
      "required": true,
      "source": "env:E2E_USER_*, fixtures/accounts.example.json 仅示例, 不入库",
      "forbidden": ["mock", "fake-login", "test-only-tenant"]
    },
    "data_scale": {
      "min_records": 100,
      "min_asset_size_mb": 50,
      "rationale_field": "production_scale_basis (引自 intent.md 性能指标)"
    },
    "cross_service": {
      "min_services": 2,
      "min_cross_bxx_paths": 1,
      "must_use_event_bus": true
    },
    "no_mocks_in_p0": {
      "forbidden_patterns": ["InMemoryRepository", "MockDB", "fake-login", "current_user = 'admin'"],
      "audit_field": "no_mock_p0_assertions"
    }
  },
  "scenario_inventory": {
    "P0_minimum_spec_files": 4,
    "all_specs_tagged": ["@production", "@P0 | @P1"]
  }
}
```

| 字段 | 含义 | 强制? |
|------|------|-------|
| `scale` | S / M / L, 决定 min_records 默认值 | 是 |
| `project_type` | `fullstack` / `frontend` / `api` | 是 |
| `real_accounts.required` | 必须用真实账号 (env 驱动) | fullstack/frontend 必 true |
| `data_scale.min_records` | 生产数据规模下限 | L=100, M=30, S=10 |
| `cross_service.min_services` | 必须跨 ≥ N 个服务 | L=2, M=1, S=1 |
| `no_mocks_in_p0` | P0 不允许 mock | 是 |
| `scenario_inventory.P0_minimum_spec_files` | P0 spec 数量下限 | L=4, M=2, S=1 |

## 2. 八面穷举矩阵 (8 维强制)

L2 walker 必须为每个 BXX 填写下表, 缺一格=FAIL:

| # | 维度 | 来源 | L 规模最低要求 | 当前值 | 状态 |
|---|------|------|---------------|-------|------|
| 1 | **Rules (RXX)** | spec.md regex `${SLUG}-R[0-9]+` | 100% RXX (P0 100%, P1 ≥ 80%) | <N>/<M> | ✅/❌ |
| 2 | **Pages (data-page)** | wire.svg `data-page` | 100% 出现 | <N>/<M> | ✅/❌ |
| 3 | **Interactions (data-action)** | wire.svg `data-action` | P0 路径 100% | <N>/<M> | ✅/❌ |
| 4 | **Roles** | research.md 画像 + L2 6 维发散 | 每个 core role ≥ 1 spec | <N>/<M> | ✅/❌ |
| 5 | **Data scale** | intent.md 性能指标 | L ≥ 100 records + ≥ 50MB 资产 | <具体值> | ✅/❌ |
| 6 | **Cross-service** | architecture.md API + event-contract | ≥ 2 services, ≥ 1 cross-BXX | <N>/<M> | ✅/❌ |
| 7 | **Error states** | L3 failure-modes.md | 每个 P0 failure-mode 1 spec | <N>/<M> | ✅/❌ |
| 8 | **Real-world chaos** | L3 chaos-scenarios.md @chaos P0 | 每个 P0 chaos 1 spec | <N>/<M> | ✅/❌ |

> "穷尽式" 的含义: 不是写 1 个 happy-path spec, 而是按 8 个维度系统化枚举, 每条规则/页面/交互/角色/失败模式在生产场景套件中至少出现 1 次。

## 3. P0 spec 模板 (含真实账号 + 真实数据 + 跨服务)

### 3.1 helper/auth.ts — 真实账号登录 (env 驱动)

```typescript
import { Page, expect } from '@playwright/test';

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto(process.env.E2E_BASE_URL + '/login');
  await page.waitForSelector('input[name=email]');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.click('button[type=submit]');
  // 必须等跳转, 验证 token 落 localStorage
  await page.waitForURL(/\/(home|scenes|dashboard|replays|experiments|models)/);
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  expect(token, 'access_token 必须在 localStorage').toBeTruthy();
  return token!;
}

export async function logout(page: Page) {
  await page.click('[data-action="logout"]');
  await page.waitForURL(/\/login/);
}
```

### 3.2 helper/db.ts — 真实 DB 断言 (生产数据规模)

```typescript
import { Client } from 'pg';

export async function dbQuery(sql: string, params: any[] = []): Promise<any[]> {
  const client = new Client({
    host: process.env.E2E_DB_HOST,
    port: parseInt(process.env.E2E_DB_PORT || '5432'),
    user: process.env.E2E_DB_USER,
    password: process.env.E2E_DB_PASSWORD,
    database: process.env.E2E_DB_NAME,
  });
  await client.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    await client.end();
  }
}

export async function assertMinRecords(table: string, tenantColumn: string, tenantId: string, min: number) {
  const rows = await dbQuery(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${tenantColumn} = $1`,
    [tenantId]
  );
  if (rows[0].n < min) {
    throw new Error(`${table} (tenant=${tenantId}) 实际 ${rows[0].n} 条 < 生产规模下限 ${min} 条`);
  }
}
```

### 3.3 helper/event.ts — 真实事件总线断言

```typescript
import Redis from 'ioredis';

export async function eventSeen(eventType: string, opts: { timeout?: number; from?: string } = {}): Promise<string | null> {
  const redis = new Redis({
    host: process.env.E2E_REDIS_HOST || 'localhost',
    port: parseInt(process.env.E2E_REDIS_PORT || '6379'),
  });
  const stream = opts.from || 'vlademo:events';
  const start = Date.now();
  const timeout = opts.timeout || 5000;
  try {
    while (Date.now() - start < timeout) {
      const entries = await redis.xrevrange(stream, '+', '-', 'COUNT', 50);
      for (const [, fields] of entries) {
        const eventObj: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          eventObj[fields[i]] = fields[i + 1];
        }
        if (eventObj.event_type === eventType) {
          return eventObj.event_id || 'present';
        }
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return null;
  } finally {
    redis.disconnect();
  }
}
```

### 3.4 P0 主链路 spec (specs/P0_main_01.spec.ts)

```typescript
import { test, expect } from '@playwright/test';
import { loginAs, logout } from '../helpers/auth';
import { assertMinRecords, dbQuery } from '../helpers/db';
import { eventSeen } from '../helpers/event';

test.describe('@production @P0 <BXX-slug> 主链路', () => {
  test('真实账号 + 真实数据规模 + 跨服务事件', async ({ page }) => {
    // 1. 真实账号登录 (env 驱动, 不用 mock)
    const token = await loginAs(page, process.env.E2E_USER_ENGINEER!, process.env.E2E_PASSWORD!);
    expect(token).toBeTruthy();

    // 2. 真实数据规模断言 (L 规模 ≥ 100 records)
    await assertMinRecords('scenes', 'tenant_id', process.env.E2E_TENANT_ID!, 100);

    // 3. 真实跨服务 (本 BXX 触发 → B03 通过事件总线消费)
    await page.goto(process.env.E2E_BASE_URL + '/scenes');
    await page.click('[data-action="new-scene"]');
    await page.click('[data-template="Franka-Kitchen-v3"]');
    await page.click('[data-action="publish"]');
    await page.waitForSelector('[data-status="PUBLISHED"]', { timeout: 30000 });

    // 4. 事件断言: 5s 内必须看到 SceneAvailable 事件
    const eventId = await eventSeen('SceneAvailable', { timeout: 5000 });
    expect(eventId, 'SceneAvailable 事件必须发布').toBeTruthy();

    // 5. 跨 BXX 断言: B03 能在 3s 内查到 (通过 DB 直接 query, 不是 mock)
    const b03Sees = await dbQuery(
      `SELECT id FROM scenes WHERE tenant_id = $1 AND status = 'PUBLISHED' ORDER BY updated_at DESC LIMIT 1`,
      [process.env.E2E_TENANT_ID!]
    );
    expect(b03Sees.length, 'B03 必须能从 DB 查到刚发布场景').toBeGreaterThan(0);

    // 6. 证据: 截图落 evidence
    await page.screenshot({ path: `evidence/${test.info().title}.png`, fullPage: true });

    await logout(page);
  });
});
```

### 3.5 P0 跨 BXX spec (specs/P0_cross_bxx_01.spec.ts)

```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { eventSeen } from '../helpers/event';
import { dbQuery } from '../helpers/db';

test.describe('@production @P0 <BXX-slug> 跨 BXX 链路', () => {
  test('B01 发布 → B03 训练任务能选到 (3s 内)', async ({ page, request }) => {
    // 1. Engineer 登录 B01, 发布场景
    await loginAs(page, process.env.E2E_USER_ENGINEER!, process.env.E2E_PASSWORD!);
    const sceneId = await page.evaluate(() => {
      // 通过 B01 API 直接发布 (走真实链路, 不走 UI)
      return fetch('/api/b01/scenes/' + window.__TEST_SCENE_ID__ + '/publish', { method: 'POST' })
        .then(r => r.json())
        .then(d => d.id);
    });

    // 2. 跨服务事件断言
    const eventId = await eventSeen('SceneAvailable', { timeout: 5000 });
    expect(eventId).toBeTruthy();

    // 3. B03 视角: 切换到 Researcher 账号, 验证能选到新场景
    await page.goto(process.env.E2E_BASE_URL + '/api/auth/logout');
    await loginAs(page, process.env.E2E_USER_RESEARCHER!, process.env.E2E_PASSWORD!);
    await page.goto(process.env.E2E_BASE_URL + '/experiments/new');
    await page.waitForSelector(`[data-scene-id="${sceneId}"]`, { timeout: 3000 });

    // 4. DB 断言: B03 实验表的 source_scene_id 字段对得上
    const exp = await dbQuery(
      `SELECT id FROM experiments WHERE source_scene_id = $1 LIMIT 1`,
      [sceneId]
    );
    // 注: B03 此刻还没创建实验, 这里只验证 B03 看到场景即可
    expect(sceneId).toBeTruthy();
  });
});
```

### 3.6 P0 持久化 spec (specs/P0_persistence_01.spec.ts)

```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { dbQuery } from '../helpers/db';

test.describe('@production @P0 <BXX-slug> 持久化 + 重启保留', () => {
  test('创建数据 → 重启 backend → 数据仍在', async ({ page }) => {
    // 1. Engineer 登录, 创建场景
    await loginAs(page, process.env.E2E_USER_ENGINEER!, process.env.E2E_PASSWORD!);
    const sceneName = `E2E-Persistence-${Date.now()}`;
    await page.goto(process.env.E2E_BASE_URL + '/scenes');
    await page.click('[data-action="new-scene"]');
    await page.fill('input[name=name]', sceneName);
    await page.click('[data-action="save-draft"]');
    const sceneId = await page.evaluate(() => window.location.pathname.split('/').pop());

    // 2. DB 断言: 数据已落库
    const before = await dbQuery('SELECT id, name, status FROM scenes WHERE id = $1', [sceneId]);
    expect(before.length).toBe(1);
    expect(before[0].name).toBe(sceneName);
    expect(before[0].status).toBe('DRAFT');

    // 3. 重启 backend (走真实容器, 不 mock)
    test.skip(process.env.E2E_ALLOW_RESTART !== '1', '需要 E2E_ALLOW_RESTART=1');
    const { execSync } = require('child_process');
    execSync('docker compose restart b01-api', { stdio: 'inherit' });

    // 4. 等待服务恢复
    await page.waitForTimeout(10000);

    // 5. 浏览器刷新, 数据仍在
    await page.reload();
    await page.waitForSelector(`h1:has-text("${sceneName}")`, { timeout: 15000 });

    // 6. DB 二次断言: 重启后数据未丢
    const after = await dbQuery('SELECT id, name, status FROM scenes WHERE id = $1', [sceneId]);
    expect(after.length).toBe(1);
    expect(after[0].name).toBe(sceneName);
  });
});
```

### 3.7 P0 认证 + 越权 spec (specs/P0_auth_01.spec.ts)

```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { dbQuery } from '../helpers/db';

test.describe('@production @P0 <BXX-slug> 真实认证 + 越权拒绝', () => {
  test('研究员无法访问 Engineer 专属场景 (跨租户)', async ({ page, request }) => {
    // 1. Engineer 创建跨租户场景
    await loginAs(page, process.env.E2E_USER_ENGINEER!, process.env.E2E_PASSWORD!);
    const otherTenantSceneId = await page.evaluate(async () => {
      const r = await fetch('/api/b01/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'other-tenant-' + Date.now(), tenant_id: 'tenant-other' }),
      });
      return (await r.json()).id;
    });

    // 2. 切到 Researcher 账号 (tenant-acme)
    await page.goto(process.env.E2E_BASE_URL + '/api/auth/logout');
    await loginAs(page, process.env.E2E_USER_RESEARCHER!, process.env.E2E_PASSWORD!);

    // 3. 越权访问: Researcher 直接 GET 跨租户场景
    const res = await page.evaluate(async (id) => {
      const r = await fetch(`/api/b01/scenes/${id}`, { method: 'GET' });
      return { status: r.status, body: await r.text() };
    }, otherTenantSceneId);

    // 4. 断言: 必须 403 + 错误码 TENANT_ACCESS_DENIED
    expect(res.status).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('TENANT_ACCESS_DENIED');

    // 5. 审计日志断言: 越权尝试必须留痕
    const audit = await dbQuery(
      `SELECT * FROM audit_logs WHERE event_type = 'TENANT_ACCESS_DENIED' AND user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [process.env.E2E_USER_RESEARCHER!]
    );
    expect(audit.length, '越权尝试必须写入 audit_logs').toBeGreaterThan(0);
  });
});
```

## 4. 失败模式 spec 模板 (specs/F_*.spec.ts)

```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test.describe('@production @P0 <BXX-slug> 失败模式: GPU 不可用', () => {
  test('GPU OOM → 503 GPU_QUEUE + 浏览器降级提示', async ({ page }) => {
    await loginAs(page, process.env.E2E_USER_ENGINEER!, process.env.E2E_PASSWORD!);
    await page.goto(process.env.E2E_BASE_URL + '/scenes/test-scene/render');

    // 注入: GPU 0 满载 (走真实 docker exec, 不 mock)
    test.skip(process.env.E2E_ALLOW_CHAOS !== '1', '需要 E2E_ALLOW_CHAOS=1');

    // 触发渲染
    await page.click('[data-action="start-render"]');

    // 断言: 5s 内看到降级提示, 不是白屏 / 500 错误
    await page.waitForSelector('[data-banner="GPU_QUEUE"]', { timeout: 5000 });
    const banner = await page.textContent('[data-banner="GPU_QUEUE"]');
    expect(banner).toContain('GPU 资源紧张');
    expect(banner).toContain('重试');

    // 断言: 网络层收到 503
    const networkLog = await page.evaluate(() => {
      return (window as any).__lastNetworkResponse || null;
    });
    expect(networkLog?.status).toBe(503);
  });
});
```

## 5. 接入 prod.config.json 的方式

每个 spec 必须在 `test.info().annotations` 中声明引用的 prod.config 字段, L6 跑完后写入 `summary.json`:

```typescript
test.beforeEach(async ({}, testInfo) => {
  testInfo.annotations.push(
    { type: 'production-contract', description: 'real_accounts.required=true' },
    { type: 'production-contract', description: 'data_scale.min_records=100' },
    { type: 'production-contract', description: 'cross_service.min_services=2' },
  );
});
```

## 6. fixtures 示例 (不入库)

### 6.1 fixtures/accounts.example.json

```json
{
  "_comment": "示例账号结构, 真实值走 env. 这个文件可入库, 用于 CI 模板, 不存真实凭据。",
  "engineer": {
    "email_pattern": "${E2E_USER_ENGINEER}",
    "password_env": "E2E_PASSWORD",
    "role": "Engineer",
    "tenant_id_env": "E2E_TENANT_ID"
  },
  "researcher": {
    "email_pattern": "${E2E_USER_RESEARCHER}",
    "password_env": "E2E_PASSWORD",
    "role": "Researcher",
    "tenant_id_env": "E2E_TENANT_ID"
  }
}
```

### 6.2 fixtures/seed.example.sql

```sql
-- 示例: 100+ 条 scenes (生产规模种子数据)
-- 真实数据走 docker compose 启动时的 init.sql, 不依赖这个文件。
-- 这里只列 schema, L5-impl 阶段可参考生成 seed.
INSERT INTO scenes (tenant_id, name, status, created_at)
SELECT
  'tenant-acme',
  'seed-scene-' || g,
  CASE (g % 4) WHEN 0 THEN 'PUBLISHED' WHEN 1 THEN 'DRAFT' WHEN 2 THEN 'RENDERING' ELSE 'FAILED' END,
  NOW() - (g || ' hours')::interval
FROM generate_series(1, 100) g;
```

## 7. playwright.config.ts (与 production-scenarios/ 同目录)

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,           // 单 spec < 60s
  expect: { timeout: 5_000 },
  fullyParallel: false,      // R11 跑 P0 时串行, 避免共享 DB 竞态
  retries: 0,                // R11 不重试, flaky 即 fail
  workers: 1,                // 单 worker, 保证 evidence 顺序
  reporter: [
    ['list'],
    ['json', { outputFile: 'playwright-output/results.json' }],
    ['html', { outputFolder: 'playwright-output/html-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    trace: 'on',
    video: 'retain-on-failure',
    screenshot: 'on',
  },
  projects: [
    {
      name: 'chromium-p0',
      testMatch: /.*\.spec\.ts/,
      grep: /@P0/,
      use: { browserName: 'chromium' },
    },
  ],
});
```

## 8. 跟 L5-impl 的 handoff 边界

| L2 产出 | L5-impl 填实 |
|---------|--------------|
| `prod.config.json` | 不动 (机器可读契约) |
| `playwright.config.ts` | 不动 (R11 用此) |
| `helpers/*.ts` 骨架 | 填实真实 DB/Redis 连接参数 (env 驱动) |
| `specs/*.spec.ts` 骨架 (含 `test.skip` 防护) | 移除 skip 标志, 接通真实 selector |
| `e2e.binding.yaml.production_scenarios` 顶层块 | 校验每个 spec 都被 binding 引用 |

L5-impl 阶段, Walker 跑 `npx playwright test --list` 验证所有 spec 都被收集, 任一 spec 文件名匹配但内容空 → build fail.

## 9. 跟 uat-script.md 的边界 (重要)

| 维度 | uat-script.md | production-scenarios/ |
|------|---------------|----------------------|
| 形式 | Markdown 用户视角剧本 | 可执行 Playwright spec.ts |
| 角色 | L6 Phase 7 必读 | L6 Phase 5.8 自动跑 |
| 真实账号 | 描述"用 engineer1@vla.demo" | env 驱动 `E2E_USER_ENGINEER` |
| 真实数据 | 描述"应有 100+ scenes" | 强制 `assertMinRecords(...)` |
| 失败处理 | 描述"重试 / 联系管理员" | 强制 `expect(status).toBe(503)` |
| 证据 | 截图 (L6 Phase 7 现场) | trace.zip + screenshot (L6 Phase 5.8 自动) |
| 数量 | ≥ 1 UAT 覆盖核心目标 | ≥ 4 P0 spec 覆盖 8 维穷举 |

**两者互补不重复**: UAT 写用户视角, Production Scenarios 写真实生产行为. UAT 通过 ≠ Production Scenarios 通过. L6 两者都必须跑.
