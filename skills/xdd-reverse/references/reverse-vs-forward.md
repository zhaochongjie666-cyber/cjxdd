# Reverse vs Forward

## Reverse Baseline

从现有代码反推 `.shadow`，只能生成 baseline。

**允许状态：**

- BASELINE
- WARN
- NEEDS_FORWARD_AUDIT

**禁止状态：**

- L6 PASS
- 全链路 PASS

**反推产物约束：**

- 反推生成的流程图必须标注 `[CONF: HIGH/MEDIUM/LOW]` 置信度
- 反推生成的 spec.md 规则必须标注 `[CONF: ...]`
- 反推不得自动标记任何层为 PASS
- 反推完成后必须执行正向审计（forward-audit.sh）确认传导链

## Forward Completion

只有从 L1 正向传导到 L6，并有 Gate 证据，才能标完成。

**正向传导路径：**

```
L1 (业务母版) → L1.5 (架构) → [L2→L4] + [L3→L5] → L6 (部署)
```

**完成标准：**

- L1 Gate PASS（三角链接完整）
- L1.5 Gate PASS（规则映射完整）
- L2 Gate PASS（E2E 场景覆盖）
- L5 Plan PASS（harness-plan.md 承接完整）
- L5 Gate PASS（Harness 计划所有测试 GREEN）
- L5 Gate PASS（真实代码 @implements 追溯完整）
- L6 Gate PASS（运行态证据完整）

## 反推后正向补全流程

```
反推完成 → .shadow/ 建立 BASELINE
                ↓
       执行 forward-audit.sh → 输出正向审计报告
                ↓
       逐层补证据：L1 → L1.5 → L2 → L3 → L4 → L5 → L6
                ↓
       每层补完 → 执行 Gate → PASS → 下一层
                ↓
       全链路 PASS → 标记完成
```
