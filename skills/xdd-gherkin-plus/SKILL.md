---
name: xdd-gherkin-plus
description: |
  xdd 跨层工具 —— Gherkin 语法权威源：写好 .feature（具体值、Examples、Data Table、异常路径）。
  谁产/消费 Gherkin（spec/resilience/reverse/plan/wire）都引用本 skill 查语法与质量标准。
  不产 .feature（那归 xdd-spec），不定义 RXX 业务规则（那也归 xdd-spec），只管 Gherkin 写得对不对、够不够具体。
  触发：gherkin、feature、场景、scenario、given when then、examples、场景大纲、bdd 语法、验收标准写法、占位符改具体值。
---

# xdd-gherkin-plus — Gherkin 语法锚

> 跨层工具：不产文件，只产「Gherkin 写对没 / 够不够具体」的判断 + checklist。
> 业务语义（RXX、Feature↔RXX 契约、断言边界）归 `xdd-spec`；本 skill 只管**语法质量**。

## 我做什么 / 上游 / 下游

| | |
|---|---|
| **上游** | `xdd-spec` 的 RXX 规则 + 一条规则=一个 Feature 的契约（本 skill 不定义契约，只引用） |
| **我产出** | Gherkin 语法判断 + 质量自检 checklist（无文件产出，被引用查） |
| **下游消费者** | `xdd-spec`（写 Feature）、`xdd-resilience`（@chaos Gherkin）、`xdd-reverse`（反推 .feature）、`xdd-plan`/`xdd-wire`（读 Feature） |
| **回溯锚** | RXX（Gherkin 通过 `@covers-RXX` 标签挂回业务规则） |

## 怎么做

```
write_good_gherkin():
  1. 每场景 3-5 步（超 8 拆分）
  2. 每场景 1 个 When（多 When = 该拆场景）
  3. Then 只断言可观测输出（前端展示/后端写入/存储存在/通知/审计），不查实现细节
  4. 多类型/状态用 Scenario Outline + Examples（不复制多个雷同 Scenario）
  5. 异常路径独立 Scenario（每条一个，不混进 happy path）
```

完整关键字（Feature/Rule/Background/Scenario Outline/Examples/Doc String/Data Table/Tags/i18n）：`详见 references/gherkin.md`。

## 占位符必须落地为具体值

Gherkin 最常见的毛病是「占位式笼统」—— Given/Then 写了动作但没给可验证的具体变量。对比：

### ❌ 笼统（看不出验证什么）
```gherkin
Scenario: 指标重算立即刷新
  Given 指标已计算完成
  When 用户触发重算
  Then 后端立即重新执行指标计算并刷新缓存
```

### ✅ 具体（具体 ID + 缓存键 + 可测阈值 + 可观测产物）
```gherkin
Scenario: 指标重算立即刷新
  Given 指标 "acc_001" 已基于 eval_config_hash="abc123" 计算完成，缓存键 metric:acc_001:abc123 已写入
  When 用户对指标 "acc_001" 触发重算
  Then 后端应在 1s 内重新执行计算
    And 缓存键 metric:acc_001:abc123 应被覆盖为最新结果
    And 前端应展示指标 "acc_001" 的 updated_at 更新为当前时间戳
```

```
# 笼统 → 具体 的通用规则（详见 references/gherkin.md §8）
make_concrete(step):
  replace [值]/[错误码]/[字段]  ->  从 design.md / 端点清单取的真实字面量（具体 ID/状态枚举）
  时间/数量类断言              ->  可测阈值（"1s 内" / "≥3 条"），禁 "立即"/"大量"/"高质量"
  ID / 键名                    ->  具体（metric:acc_001:abc123），禁 "某个缓存"
  告警 / 通知                  ->  可观测产物（用户文案 / audit_log / 事件总线消息），禁 "系统应告警" 就结束
```

第二个对比（评测配置不一致告警）+ 更多展开见 `references/gherkin.md § 8`。

## 产出

```
无文件产出。被其他 skill 引用查：
  - "Gherkin 这么写对吗？"     ->  本 skill 核心 5 条 + references/gherkin.md
  - "够不够具体？"             ->  本 skill「占位符落地」规则 + §8 对比
```

## 自检

```
□ 所有 [值]/[错误码]/[字段] 占位符都替换成具体字面量了？
□ 时间/数量断言给了可测阈值（不是"立即"/"大量"）？
□ ID / 键名 / 状态枚举具体（不是"某个缓存"/"某条记录"）？
□ 多类型用 Scenario Outline + Examples（有数据行，不是空表头）？
□ 异常路径独立 Scenario（不混进 happy path）？
□ Then 只断言可观测输出（前端/后端/存储/通知/审计），不查实现细节？
□ 每个 Scenario ≤ 8 步、单 When？
```

---

Gherkin 全量语法（关键字 / Scenario Outline / Data Table / Doc String / Rule / i18n / 具体值对比全文）：`详见 references/gherkin.md`。
