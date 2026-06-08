# xdd Scale 模型

> **本文件目的**: 解释 `.xdd/scale.md` 各字段含义 + strict-default 行为 + 5 个下游 skill 怎么读

---

## 1. 规模判定 (4 维度最大值)

| 指标 | S (小) | M (中) | L (大) |
|------|---|---|---|
| 业务线数 (bizline_count) | 1 | 2-4 | ≥ 5 |
| spec 规则数 (total_rule_count) | ≤ 20 | 21-60 | ≥ 61 |
| 页面数 (page_count) | ≤ 8 | 9-20 | ≥ 21 |
| 外部依赖数 (external_dep_count) | ≤ 2 | 3-5 | ≥ 6 |

取四个指标中的**最高级别**作为 `scale` 字段。

---

## 2. scale.md 字段定义

```yaml
# .xdd/scale.md
---
project_name: <产品名>
created: 2026-MM-DD
updated: 2026-MM-DD

# === 项目规模 (取最大值) ===
bizline_count: 1
total_rule_count: 50
page_count: 12
external_dep_count: 3

# === 推导 ===
scale: M  # 上面最大值: S<5, M<20, L<50, XL>=50

# === strict-default 开关 ===
strict_mode: true   # 默认 L 规模 + 扩展模式, 显式 false 才降级

# === 阶段触发 ===
l0_required: true          # scale >= M 触发 xdd-l0
l3_required: true          # 全部规模强制
l6_required: true          # scale >= M 触发 xdd-l6
scaffold_required: true    # 新项目触发 xdd-scaffold
bxx_enabled: false          # bizline_count > 1 时强制 true
persona_max: 12
persona_dimensions: 8
coverage_dimensions: 20
wire_passes: 4
l3_extended_mode: true

# === 验收约束 ===
no_advisory: true
halt_after: 3
```

---

## 3. strict-default 行为

**核心原则**: scale.md 字段 `strict_mode: true` 默认 (用户偏好). 5 个下游 skill 读这个字段不读 scale 标签. 降级必须显式 (改字段, 不改 scale 标签).

| 字段 | 谁读 | strict-mode=true | strict-mode=false |
|------|------|------------------|-------------------|
| `l0_required` | xdd-walker | true (M+) | 按 scale 推导 |
| `l3_required` | xdd-walker | true (全部) | true (全部) |
| `l6_required` | xdd-walker | true (M+) | 按 scale 推导 |
| `scaffold_required` | xdd-walker | true | true |
| `bxx_enabled` | xdd-walker | false | bizline_count > 1 时 true |
| `persona_max` | xdd-bdd | 12 | 按 scale 推导 |
| `persona_dimensions` | xdd-bdd | 8 | 按 scale 推导 |
| `coverage_dimensions` | xdd-bdd | 20 | 按 scale 推导 |
| `wire_passes` | xdd-wire | 4 | 按 scale 推导 |
| `l3_extended_mode` | xdd-l3 | true | scale=L 才自动 true |
| `no_advisory` | xdd-walker | true | true |
| `halt_after` | xdd-walker | 3 | 3 |

---

## 4. 字段影响下游 skill 行为

### 4.1 xdd-l0
- `l0_required=true` → 必跑 (v2 brainstorm + 5 方向 + L1 消费)
- `l0_required=false` → 跳过 (直进 Phase 2)

### 4.2 xdd-bdd
- `persona_dimensions=8` → 画像按 8 维度发散
- `persona_max=12` → 收敛后画像 ≤ 12
- `coverage_dimensions=20` → 20 维覆盖矩阵

### 4.3 xdd-wire
- `wire_passes=4` → 4-Pass 生成 (骨架 → 填充 → 契约 → 品味)
- `wire_passes=2` → 2-Pass 合并 (S 规模时)

### 4.4 xdd-l3
- `l3_extended_mode=true` → 9 维 + 12 模式 + 8 字段
- `l3_extended_mode=false` → 8 维 + 10 模式 + 5 字段

### 4.5 xdd-l6
- `l6_required=true` → 必跑 (health-check + wander-test + chaos drill)
- `l6_required=false` → 跳过 (Phase 7-9 简版)

---

## 5. 字段变更传播

| 改了什么 | 必重跑 |
|---------|--------|
| `scale: S → L` | Phase 1-6 全部 (新增子阶段) |
| `strict_mode: false → true` | Phase 4-5 (plan/impl 质量提升) |
| `l3_extended_mode: false → true` | Phase 3 (L3 扩 9 维) |
| `bxx_enabled: false → true` | Phase 2 (BXX 业务线分组) |
| `persona_dimensions` | Phase 1 (画像发散) |
| `coverage_dimensions` | Phase 2.5 (BDD 覆盖矩阵) |
| `wire_passes` | Phase 2 (Wire 生成) |
| `halt_after` | 下次 Phase 5 失败 (HALT 触发) |
