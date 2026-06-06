# L5 Plan vs Impl 差异审计（Plan-Impl Diff）

## 为什么需要差异审计

L5-plan 写了 Harness 计划，L5-impl 写代码，但**写了 ≠ 实现了**。常见漂移：

1. **方法未实现**：Plan 列了 10 个方法，Impl 只实现了 8 个
2. **方法签名漂移**：Impl 改了 Plan 没改
3. **测试断言漂移**：Plan 列了 5 个断言，Impl 只写了 2 个
4. **事件发布漂移**：Plan 说要发布 X 事件，Impl 没发
5. **超范围实现**：Impl 加了 Plan 没列的方法
6. **规则漏标**：Plan 引用 R12，实际 @implements 没标
7. **failsafe 漏实现**：L3 列了 BXX-FS01 兜底，Impl 没实现

**差异审计 = L5-impl 完成后，自动对比 Plan vs Code，输出 diff 报告**。

## 审计时机

| 时机 | 目的 | 范围 |
|------|------|------|
| L5-impl 完成每个 Batch | 早发现早修复 | 当前 Batch 的文件 |
| L5-impl 完成全部 | 全局审计 | 全部代码 |
| L6 漫游前 | 漫游前回归 | 关键路径 |
| 重大变更后 | 重新确认完整性 | 变更影响范围 |

## 审计 5 大维度

### 1. 方法覆盖（Method Coverage）

**检查**：Plan 列的所有方法是否都已实现？

```python
# 伪代码
plan_methods = parse_harness_plan("harness-plan.md")  # {class: [methods]}
impl_methods = grep_code(backend/)  # {class: [methods]}

missing = plan_methods - impl_methods
extra = impl_methods - plan_methods
```

**报告项**：
```yaml
- check: method_coverage
  class: Annotation
  plan_methods: [create, submit, cancel]
  impl_methods: [create, submit]
  missing: [cancel]
  severity: high
  fix: 实现 cancel 方法
```

### 2. 方法签名一致性（Signature Consistency）

**检查**：Impl 的方法签名是否与 Plan 一致？

```python
plan_sig = "def submit(self) -> None"
impl_sig = "def submit(self, force: bool = False) -> None"  # 多了参数
```

**报告项**：
```yaml
- check: signature
  method: Annotation.submit
  plan: "def submit(self) -> None"
  actual: "def submit(self, force: bool = False) -> None"
  severity: medium
  fix: 对齐 plan（删除 force 参数或更新 plan）
```

### 3. 测试断言覆盖（Test Coverage）

**检查**：Plan 列的所有测试断言是否都已写？

```python
plan_tests = parse_harness_plan_tests()  # {class: {method: [assertions]}}
impl_tests = grep_test_files()

# 例：plan 列 5 个测试，impl 只写 2 个
```

**报告项**：
```yaml
- check: test_coverage
  class: Annotation.submit
  plan_tests:
    - "test_submits_when_in_progress"
    - "test_rejects_when_empty"
    - "test_raises_invalid_state_error"
    - "test_publishes_annotation_submitted_event"
    - "test_updates_submitted_at"
  impl_tests:
    - "test_submits_when_in_progress"
    - "test_rejects_when_empty"
  missing: [test_raises_invalid_state_error, test_publishes_annotation_submitted_event, test_updates_submitted_at]
  severity: high
  fix: 补齐 3 个测试
```

### 4. 事件发布一致性（Event Publishing Consistency）

**检查**：Plan 列的事件是否真的发布？

```python
# 提取 Plan 中标注的事件
plan_events = {"Annotation.submit": ["AnnotationSubmitted"]}
# grep 代码中实际发布的事件
impl_events = grep_publish_event_calls()

# 缺哪几个？
```

**报告项**：
```yaml
- check: event_publishing
  method: Annotation.submit
  plan_events: [AnnotationSubmitted]
  actual_events: []
  missing: [AnnotationSubmitted]
  severity: high
  fix: 在 submit 末尾发布 AnnotationSubmitted 事件
```

### 5. @implements 标签完整性（@implements Coverage）

**检查**：每条 spec 规则（RXX）是否都有 @implements 引用？

```python
plan_rules = parse_spec_md()  # [R01, R02, ...]
impl_rules = grep_implements_tags()  # [R01, R03, ...]

# 双向对比
```

**报告项**：
```yaml
- check: implements_tags
  plan_rules: 23
  impl_rules: 21
  missing: [R12, R15]
  extra: [R99]  # Impl 引用了不存在的规则
  severity: high
  fix: 给 R12 R15 补 @implements
```

## 与 L3 的对接

**Failsafe 实现审计**：

```python
# L3 列了所有 BXX-FSXX
failsafes = load_yaml(".shadow/L3-fdd/{slug}/failsafe-design.yaml")

for fs in failsafes:
    # 找代码实现
    impl = grep(f"class {fs['class']}", "backend/")
    # 找单元测试
    unit = grep(fs['id'], "tests/unit/")
    # 找混沌测试
    chaos = grep(fs['id'], "tests/chaos/")
    
    report(fs, impl, unit, chaos)
```

**报告项**：
```yaml
- check: failsafe_implementation
  failsafe: B02-FS04 (Nomad 调度风暴)
  code_path: backend/infrastructure/resilience/nomad_circuit.py:42
  test_unit: tests/unit/test_nomad_circuit.py
  test_chaos: tests/chaos/test_nomad_f04.py
  status: implemented
```

## 审计报告模板

```markdown
# L5 Plan-Impl 差异审计报告

> Slug: {slug}
> 审计时间: {timestamp}
> 审计范围: {全部代码 / Batch N}

## 汇总

| 维度 | 通过 | 警告 | 严重 |
|------|------|------|------|
| 方法覆盖 | {p} | {w} | {c} |
| 方法签名 | {p} | {w} | {c} |
| 测试覆盖 | {p} | {w} | {c} |
| 事件发布 | {p} | {w} | {c} |
| @implements | {p} | {w} | {c} |
| failsafe 实现 | {p} | {w} | {c} |
| **合计** | **{p}** | **{w}** | **{c}** |

## 严重问题（必须修）

### 方法未实现

1. **Class.method** — Plan 列出，未实现
2. ...

### 测试缺失

1. **test_xxx** — Plan 列出，未写
2. ...

### 事件未发布

1. **Annotation.submit** — 应发布 AnnotationSubmitted，未发布
2. ...

### @implements 缺失

1. **R12** — 无实现文件标注
2. ...

### Failsafe 缺失

1. **B02-FS04** — 未在代码中实现
2. ...

## 警告

1. **方法签名漂移**：...
2. **超范围实现**：...

## 通过

- 21/23 规则有 @implements
- 13/15 方法已实现
- ...

## 修复建议

- **严重**: 阻断 L6 漫游
- **警告**: 不阻断 L6，下个迭代修
- **通过**: 不动

## 审计结果

**判定**: PASS / CONDITIONAL / FAIL
**签名**: {agent / timestamp}
```

## 自动审计脚本

`scripts/plan-impl-diff.sh <slug>` 实现：

```bash
#!/usr/bin/env bash
# 1. 解析 harness-plan.md
# 2. grep 代码实际方法和签名
# 3. diff + 输出报告
```

可集成进 L5 gate 检查。

## 反模式

❌ **「代码写完就过」**：代码 ≠ Plan 实现，必须审计
❌ **「只在 L6 做一次」**：每 Batch 都该审
❌ **「审计失败拖到下个迭代」**：严重问题必须当下修
❌ **「Plan 跟代码走」**：Plan 是约束，代码改 Plan 也要改
❌ **「Impl 写 Plan 没列的方法」**：超范围实现是「隐藏债务」

## 与其他层的关系

```
L5-plan 写 Harness 计划
  ↓
L5-impl 按计划写代码
  ↓ (每 Batch 后审计)
L5 plan-impl-diff
  ↓ (严重问题)
回 L5-impl 修复
  ↓
L6 deploy 漫游
```

## 门禁

plan-impl-diff FAIL → 阻断 L6 漫游。

## 工具

- 手动：本文档的检查项
- 脚本：`scripts/plan-impl-diff.sh <slug>`
- 集成：可写 `scripts/plan-impl-diff.py <slug>` 自动化

## 与 Walker 三面手原则的关系

L5-plan 完整三面手：

| 面 | 内容 |
|---|------|
| **设计** | Harness 计划（harness-plan.md）|
| **实现** | 代码骨架自动生成（skeleton-gen.py）|
| **跟踪** | plan-impl-diff（plan vs impl 审计）|
