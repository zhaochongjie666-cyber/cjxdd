---
name: nf-execute
description: |
  Normal Flow 第 4 阶段（implement）-- 按 plan 的 task 逐步 TDD 实现，代码用 @implements RXX 回指规则。
  反 sham 交付底线：无存根、无假实现、必须跑通有证据。必须留可被 verify curl/UI 访问的入口（HTTP/CLI/页面）。
  触发：normal-flow execute、nf execute、执行计划、实现、写代码、TDD、开工。
---

# nf-execute -- 代码锚

**我做什么**：按 plan 把代码写出来。无存根、无假实现、必须跑通有证据。

**上游**：`nf-plan` 的 plan.md + `nf-spec` 的 RXX + design/ 共享设计层
**我产出**：source code（`src/`、`lib/`、`app/`、`tests/`）
**下游**：`nf-verify` 跑测试 + curl + nf_wander

> **无损切换原则**：代码是项目级共享资产（不是 run 级）。如果 cwd 上已有 xdd-execute 产的源码，READ + EXTEND，不要覆盖。`@implements RXX` 标注要和 xdd 产的标注一致，不能重复编号。如果 xdd 已实现了某 RXX，NF 不必重写，只在 verify 阶段验证即可。

## 怎么做

### 1. 按 plan task 逐步 TDD

对每个 `### Task` 块：

```
① 读 RXX + Feature + Implementation + Acceptance Test
② 先写失败测试（按 Acceptance Test 命令）
③ 跑测试 -> RED
④ 写最小实现（按 Implementation 路径）
⑤ 在源码加 @implements RXX 标注
⑥ 跑测试 -> GREEN
⑦ 补 Attack 失败测试 -> RED -> 修实现 -> GREEN
⑧ git commit（每 task 一次）
```

### 2. @implements RXX 标注

```typescript
// src/auth.ts

// @implements R01
export async function login(user: string, pwd: string): Promise<{ token: string }> {
  // ... 真实实现
}

// @implements R02
export async function deny(user: string, pwd: string): Promise<{ error: string }> {
  // ... 真实实现
}
```

verify 的 TRACE_GAP gate 扫描源码匹配 `@implements\s+((?:B\d{2}-)?R\d{2})` 正则。
业务线前缀：`@implements B01-R01`。

### 3. 留可访问入口

至少满足其一（否则 verify 的 HEALTH_CHECK_MISSING / BUSINESS_ENDPOINT_UNTESTED gate 拿不到证据）：

**HTTP 服务**：
```typescript
const server = app.listen(8000);
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
```

**CLI 工具**（package.json）：
```json
"bin": { "myapp": "./dist/cli.js" }
```

**前端页面**：
```bash
npm run dev  # vite/webpack dev server
# 或 python -m http.server 8000
```

### 4. 跑 nf-wander.sh 抓证据骨架（建议）

execute 跑通后立即跑：

```bash
bash extensions/normal-flow/scripts/nf-wander.sh
```

脚本自动：识别项目类型 -> 起服务 -> 抓 /healthz -> 抓 9 个候选业务端点 -> 写 `evidence/health-check.txt` + `evidence/responses/` + `evidence/wander-report.md` 骨架。
verify 阶段直接用 nf_wander 填实际观察即可，不必凭空造证据。

## 纪律（反 sham 交付底线）

- **无存根** -- 不能有 `// TODO`、`return null`、`throw new Error("not implemented")` 占位
- **无假实现** -- 函数不能返回硬编码值；@implements RXX 的代码必须真的实现 RXX 规则
- **必须跑通** -- `npm test` / `go test` / `make test` 必须 exit 0
- **必须留入口** -- 至少有一个 HTTP 端口 / CLI 命令 / 页面
- **失败测试要补** -- plan 的 Attack 用例必须有失败测试覆盖

## 自检

- [ ] 每个 task 跑过 TDD（RED -> GREEN）
- [ ] 每条 spec RXX 有 @implements RXX 标注
- [ ] 无存根 / TODO / 假实现
- [ ] npm test / go test / make test exit 0
- [ ] 代码有可访问入口（HTTP/CLI/页面）
- [ ] Attack 失败测试已补
- [ ] （建议）跑过 nf-wander.sh 抓了证据骨架

## 工具

```
nf_observe / nf_desired_state / nf_difference
read .xdd/runs/normal_run/plan.md + .xdd/design/**
write/edit src/ lib/ app/ tests/
bash: npm test / npm run dev / bash scripts/nf-wander.sh
nf_submit_artifact -> nf_advance
```
