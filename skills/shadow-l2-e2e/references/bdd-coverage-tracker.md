# L2 BDD 覆盖率追踪（Coverage Tracker）

## 为什么需要覆盖率追踪

L2 写了 14 维覆盖矩阵，号称"全覆盖"，但**写了的覆盖 ≠ 真覆盖**。常见问题：

1. **场景写完不跑**：覆盖矩阵上写的"P0 已覆盖"，实际场景没跑过
2. **跑了不追踪**：跑过 N 次没统计通过率
3. **挂了不修**：失败的场景 P0 挂了 P1，没人管
4. **新增不更新**：新加规则时没补场景，覆盖率悄悄下降
5. **回归无据**：不知道上次通过的版本 vs 现在

**覆盖率追踪 = 在 L6 跑场景时自动累积数据，量化"覆盖矩阵"是不是真的覆盖了**。

## 追踪对象

每个 e2e 场景（Scenario）追踪：

| 字段 | 来源 | 用途 |
|------|------|------|
| `feature_file` | L2 | 定位 |
| `scenario_name` | L2 | 定位 |
| `@covers` | L2 | 反向追溯到 RXX / BXX-NYY |
| `priority` | L2 | P0/P1/P2 |
| `run_count` | L6 | 总跑过次数 |
| `pass_count` | L6 | 通过次数 |
| `fail_count` | L6 | 失败次数 |
| `flaky_count` | L6 | 时过时不通过次数 |
| `last_run_at` | L6 | 上次跑时间 |
| `last_status` | L6 | pass / fail / skip |
| `last_failure_reason` | L6 | 上次失败原因 |
| `avg_duration_ms` | L6 | 平均耗时 |
| `p95_duration_ms` | L6 | P95 耗时 |

## 数据结构

`e2e/coverage-tracker.json`（自动生成，git 跟踪）：

```json
{
  "generated_at": "2026-06-05T10:30:00Z",
  "project": "my-project",
  "summary": {
    "total_scenarios": 50,
    "p0_scenarios": 12,
    "p1_scenarios": 25,
    "p2_scenarios": 13,
    "scenarios_run": 48,
    "scenarios_never_run": 2,
    "scenarios_passing": 45,
    "scenarios_failing": 3,
    "overall_pass_rate": 0.938
  },
  "scenarios": [
    {
      "id": "B02-annotation.feature:8",
      "feature_file": "e2e/annotation.feature",
      "scenario_name": "标注员创建有效 2D 框标注",
      "covers": ["annotation-R12", "B02-N08"],
      "priority": "P0",
      "run_count": 25,
      "pass_count": 25,
      "fail_count": 0,
      "flaky_count": 0,
      "last_run_at": "2026-06-05T10:00:00Z",
      "last_status": "pass",
      "last_failure_reason": null,
      "avg_duration_ms": 1234,
      "p95_duration_ms": 2100
    }
  ]
}
```

## 自动更新机制

L6 跑完场景后，自动调用 `scripts/coverage-tracker-update.sh`：

```bash
# L6 跑完 Playwright
npx playwright test --reporter=json
# 输出 → coverage-tracker-update.sh
scripts/coverage-tracker-update.sh e2e/coverage-tracker.json
```

更新逻辑：

1. 读 Playwright 报告
2. 匹配每个 scenario 到 tracker 记录
3. 更新 run_count / pass_count / fail_count
4. 标记 flaky（同一 scenario 跑 N 次有失败有成功）
5. 标记 never_run（tracker 有但没跑过）
6. 重算 summary

## 覆盖率报告

每跑一次场景后生成 Markdown 报告：

```markdown
# BDD 覆盖率报告 — iter-N

生成时间: 2026-06-05
跑场景总数: 50
通过: 45 (90%)
失败: 3 (6%)
从未跑: 2 (4%)

## P0 场景

| Scenario | Run | Pass | Fail | Flaky | Last Status | Last Failure |
|----------|-----|------|------|-------|-------------|--------------|
| 创建有效 2D 框标注 | 25 | 25 | 0 | 0 | ✅ pass | — |
| 提交标注并发布事件 | 20 | 18 | 2 | 0 | ❌ fail | event 500 |
| ... |

## 失败场景（必修）

1. **提交标注并发布事件** — 上次失败：event 500
2. **驳回标注并通知** — 上次失败：timeout
3. **上传超限视频** — 上次失败：403

## 从未跑（必须补救）

1. **导出 1 万行 CSV** — 没跑过，需要先修复环境
2. **跨时区定时任务** — 没跑过，时区依赖

## Flaky 场景（需修）

(空，无 flaky)
```

## 追踪的"覆盖率"维度

### 1. 场景执行覆盖率

跑了多少 / 没跑多少

```
execution_rate = run_count > 0 的场景数 / 总场景数
```

目标：100%（所有 P0/P1 场景都至少跑过 1 次）

### 2. 规则覆盖完成度

每条 spec 规则（RXX）是否都有场景覆盖

```
rule_coverage = 有 @covers:RXX 的场景数 / 总规则数
```

来源：L1 spec.md 的 RXX 列表

### 3. 流程节点覆盖

每个 BXX-NYY 流程节点是否都有场景

```
flow_coverage = 有 @covers:BXX-NYY 的场景数 / 总节点数
```

来源：L1 project.flow.mermaid

### 4. API 端点覆盖

每个 API 端点是否都有场景间接触发

```
api_coverage = 有 step 调用该 endpoint 的场景数 / 总端点数
```

来源：L1.5 architecture.md §7 API 端点清单

### 5. 业务线覆盖

每条业务线是否都有 e2e.md

```
bizline_coverage = 有 e2e.md 的业务线数 / 总业务线数
```

### 6. 持续通过率

最近 N 次跑的平均通过率

```
recent_pass_rate = (last N runs) sum(pass) / (last N runs) sum(total)
```

目标：> 95%

## 覆盖率退化告警

自动告警触发条件：

```
1. P0 场景从未跑过 → 阻断 L6 漫游
2. P0 场景最近 3 次都失败 → 阻断 L6 漫游
3. 整体 pass_rate 下降 > 5% → 警告
4. Flaky 场景增加 → 警告
5. 新增规则没补场景 → 警告
```

## 与 L3 的对接

L3 的失败模式目录应该反向被 L2 覆盖：

```yaml
# L3 failure-catalog.yaml
- id: B02-F04
  name: Nomad 调度风暴
  e2e_target: B02-L2-T15    # 引用 L2 场景
```

L2 覆盖率追踪反向检查：

```
for each P0 failure in L3 catalog:
    e2e_target = failure.e2e_target
    if e2e_target not in BDD coverage:
        warn "P0 failure {id} 缺 e2e 场景"
```

## 与 L6 漫游的接力

L6 漫游流程：

1. 启动 Docker Compose（应用 + 依赖）
2. 跑 BDD 场景（Playwright）
3. 收集结果
4. 更新 coverage-tracker.json
5. 生成覆盖率报告
6. 检查告警条件
7. 阻断或继续

L6 漫游的"漫游修复"阶段也跑 BDD 场景，验证修复没破坏现有覆盖。

## 工具

- `scripts/coverage-tracker-update.sh` — 从 Playwright 报告更新 tracker
- `scripts/coverage-report-gen.sh` — 生成 Markdown 报告
- `scripts/coverage-alert-check.sh` — 检查告警条件
- `templates/coverage-tracker.template.json` — 初始空 tracker

## 反模式

❌ **「场景写完就完了」**：场景没跑 = 没覆盖
❌ **「不跟踪 pass_rate」**：不知道真实质量
❌ **「失败场景拖到下个迭代」**：P0 失败必须当下修
❌ **「flaky 测试不修」**：flaky 累积 = 全是 flaky
❌ **「覆盖率只看数字」**：覆盖率 100% 但都跑假的也没用

## 与 Walker 三面手原则的关系

L2 完整三面手：

| 面 | 内容 |
|---|------|
| **设计** | Gherkin 场景 + 覆盖矩阵 + UAT 剧本 |
| **实现** | Step binding 骨架 + L5-impl 填实 + step def 代码 |
| **跟踪** | coverage-tracker.json + 覆盖率报告 + 告警 + flaky 检测 |
