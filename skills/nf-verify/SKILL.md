---
name: nf-verify
description: |
  Normal Flow 第 5 阶段（verify）-- 真实验证。证明代码真做到了 + 产品连用都能用。
  19 道硬 gate 全过才能推进。约束效果对齐 xdd 的 evaluateVerifyEvidenceGateFull，实现是 filesystem check 而非 LLM。
  产出 .xdd/runs/normal_run/verify-report.md + evidence/。
  触发：normal-flow verify、nf verify、验证、verify、部署、启动、验收、smoke、漫游、wander、交付前检查。
---

# nf-verify -- 真实可用契约

**我做什么**：证明代码真做到了 + 产品连用都能用。不是「测试通过了」，是「用户能用」。

**上游**：`nf-execute`（代码 + 测试）+ `nf-plan`（plan.md + Wandering Scenarios）+ `nf-spec`（RXX + .feature）
**我产出**：`.xdd/runs/normal_run/verify-report.md` + `.xdd/runs/normal_run/evidence/`

> **无损切换原则**：verify 产物写到 `.xdd/runs/normal_run/`（NF 专属），不写 xdd_run。evidence gate 拒绝跨 run 借证据（`EVIDENCE_FROM_OTHER_RUN`）。如果 cwd 上已有 `runs/xdd_run/verify-report.md`（xdd 产的），不要读它--两个 run 的验证报告是独立的。但 `.xdd/design/` 下的 RXX / .feature 是共享的，验证时必须对照。

## 19 道硬 gate

stages.ts 的 verifyGate 调 `evaluateNormalFlowVerifyGateFull(cwd)`，任意一道 fail 都不能通过 verify。

**存在性 + 引用合规**
- `RUN_DIR_MISSING` / `REPORT_MISSING` / `REPORT_TOO_SHORT` / `PLAN_UNFINISHED` -- 基本存在性
- `EVIDENCE_MISSING` -- verify-report 引用的 evidence 文件必须真实存在
- `EVIDENCE_FROM_OTHER_RUN` -- 拒绝跨 run 借证据（`xdd_run/evidence/` 不能拿给 `normal_run` 用）
- `EVIDENCE_INSUFFICIENT` -- verify-report 需覆盖 ≥2 类别证据（runtime/http/ui/db/auth/boundary/chaos/stub）
- `UI_EVIDENCE_MISSING` -- 有 wire 产物时需补 UI 证据
- `BUSINESS_ENDPOINT_UNTESTED` -- 拒绝「只跳 /healthz」
- `HEALTH_CHECK_MISSING` -- `evidence/health-check.txt` 必须含 2xx 状态码
- `FALLBACK_EVIDENCE_MISSING` -- 必须有 4xx/5xx 响应或拒绝/无权等关键词
- `WANDER_REPORT_MISSING` -- `evidence/wander-report.md` ≥3 步骤漫游报告
- `WANDER_FEATURE_UNMAPPED` -- wander 引用 .feature 时 verify-report 需对照同一场景

**追溯闭合 + 退改护栏**
- `VERIFY_MUTATED_CONTRACT` -- verify 阶段偷偷改了 src/ / lib/ / app/ / tests/ / .xdd/design/（入场锁快照，提交时 diff）
- `TRACE_GAP` -- spec RXX 与代码 @implements 追溯链闭合
- `FEATURE_SCENARIO_GAP` -- .feature Scenario 在 plan 中需有 Feature/Implementation/Acceptance Test 三件套
- `RXX_UNTESTED` -- verify-report 需逐 RXX 写 `### RXX:` + `Verdict:` 块，拒绝「全部通过」空洞表述
- `WANDERING_NOT_WALKED` -- plan 的 `## Wandering Scenarios` 声明的场景必须真的在 wander-report 里走

## 怎么做

### 1. 起服务 + 抓证据骨架

```bash
bash extensions/normal-flow/scripts/nf-wander.sh
```

自动：识别项目类型 -> 起服务 -> 抓 /healthz -> 抓 9 个候选业务端点 -> 写 `evidence/health-check.txt` + `evidence/responses/` + `evidence/wander-report.md` 骨架。

### 2. 用 nf_wander 填漫游

```
nf_wander action=inspect                          # 看当前缺口
nf_wander action=record_step scenario=... step=... operation=... observation=... result=PASS evidencePath=.xdd/runs/normal_run/evidence/responses/xxx.html
nf_wander action=record_step ...                  # ≥3 步
nf_wander action=finish verdict=PASS reason=...
```

每步 `evidencePath` 必须指向 `.xdd/runs/normal_run/evidence/` 下真实存在的文件，工具会校验路径，拒绝编造。

### 3. 写 verify-report.md（逐 RXX + 逐 Scenario 举证）

Feature 驱动验证：每个 .feature Scenario 都必须独立验证，不能只写 RXX。

```markdown
# Verify Report

## Health check
Runtime evidence: npm test exited 0.
HTTP evidence: curl GET /healthz returned status 200.
Evidence file: .xdd/runs/normal_run/evidence/runtime.txt

### R01: 用户登录成功
- Verdict: PASS
- Evidence: .xdd/runs/normal_run/evidence/responses/login.json

### R02: 错误密码被拒
- Verdict: PASS
- Evidence: .xdd/runs/normal_run/evidence/responses/login-401.json

### Scenario: 用户登录成功
- Feature: auth.feature
- Verdict: PASS
- Evidence: .xdd/runs/normal_run/evidence/responses/login.json

### Scenario: 错误密码被拒
- Feature: auth.feature
- Verdict: PASS
- Evidence: .xdd/runs/normal_run/evidence/responses/login-401.json

### Scenario: 超长密码截断
- Feature: auth.feature
- Verdict: N/A
- (原因：限流会在上游拒接，本服务不负责)

## 兜底攻击
- 401 响应：.xdd/runs/normal_run/evidence/responses/unauthorized.json
- 404 响应：.xdd/runs/normal_run/evidence/responses/notfound.html
```

Verdict 只接受：`PASS` / `PASS_WITH_FRICTION` / `FAIL` / `BLOCKED` / `INCONCLUSIVE` / `N/A`。「已验证」「完成」「全部通过」会被 gate 拒绝。

PASS / FAIL / PASS_WITH_FRICTION 必须引用真实 evidence 文件路径；N/A 需写明原因。

### 4. 跑 verify gate

```
nf_submit_artifact pass=true
```

Gate 跑 19 道检查。任意 fail 返回拒绝码 + 修复指引，按指引修后重提。

## 纪律

- **禁偷懒归因** -- 说「网络问题」「环境问题」必须有证据链（curl 输出 / docker logs / 端口探测）
- **测试环境必须自愈** -- 缺依赖、缺浏览器、DB 没启动，不是停下来的理由；至少尝试 3 条可执行路径并留证据
- **失败穷举 ≥3 假设** -- 一个现象至少列 3 个可能原因，逐个验证排除
- **能用 ≠ 测试通过** -- 要运行证据（curl/截图/数据查询），不是 GREEN 数
- **不报假完成** -- 没跑通就直说没跑通，不写「基本完成」蒙混

## 验证环境自愈协议

当测试/启动失败的现象是「工具未安装、服务未运行、端口不对、DB 不可达、浏览器缺失」时，按下面顺序自愈：

1. 读 README / package.json / pyproject.toml / Dockerfile / docker-compose*.yml / Makefile 找官方命令
2. 联网就执行 `npm install` / `pip install -r requirements.txt` / `python -m playwright install --with-deps`
3. 优先 `docker compose up -d --wait`；若不存在再用本地服务或轻量替代
4. 启动后探测端口（`ss -tlnp` / `curl /healthz`），冲突就换端口
5. 依赖装好、服务起来后必须重跑原失败命令
6. 浏览器 E2E 跑不起来时先修 Playwright；仍失败用 curl/HTML 快照替代，标明降级范围
7. 只有连续尝试 ≥3 条路径且每条都有命令输出，才允许写「环境阻塞」

## 自检

- [ ] 19 道 gate 全过（用 nf_difference 看）
- [ ] 每条 RXX 在 verify-report 有独立块 + 明确 Verdict
- [ ] 每个 Scenario 在 verify-report 有独立块 + Verdict + Evidence（Feature 驱动）
- [ ] plan 的每个 **Implementation:** 路径在磁盘上真实存在
- [ ] health-check.txt 有 2xx 状态码
- [ ] responses/ 有 ≥1 非 /healthz 业务端点响应
- [ ] responses/ 或 verify-report 含 4xx/5xx 兜底证据
- [ ] wander-report.md ≥3 步骤，绑定 .feature Scenario
- [ ] plan 的 Wandering Scenarios 真的在 wander-report 里走过
- [ ] 没在 verify 阶段改源码（VERIFY_MUTATED_CONTRACT 会 diff 出来）

## 工具

```
nf_observe / nf_desired_state / nf_difference
read 全仓库
write .xdd/runs/normal_run/verify-report.md + evidence/
bash: npm test / bash scripts/nf-wander.sh / curl ...
nf_wander record_step / finish / inspect
nf_submit_artifact pass=true
nf_advance   # 通过后推进；或 nf_rollback 回 execute/spec/understand 修
```
