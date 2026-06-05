# Work Order Template

> Walker 派活给 worker 时**复制本文件**到 `.shadow/iterations/iter-N/work-orders/<task_id>.md`，填好字段，然后让 worker 读这个文件 + 上游 artifact 开工。
> 配套的 report 模板在文末。

---

# Work Order: <task_id>

## 状态
🔵 open / 🟡 in_progress / 🟢 done / 🔴 failed

## 阶段
L1 Spec / L1 Wire / L1.5 / L2 / L5 Plan / L5 Impl / L6 / Other

## 一句话目标
（walker 用动词 + 宾语写清楚要做什么。不要写"研究一下"这种模糊目标。）

例：实现 R01/R05/R12 三条规则的 Postgres 表 + RLS policy。

## 范围

### 包含
- ...

### 不包含（不要做）
- ...

## 交付物（必填）
- `<path/to/file>` — 说明
- ...

## 验收（必填，每条都可执行）

每条都是可一句命令 / 一步操作能验证的，不要写"代码质量高"这种主观标准。

- [ ] `<命令或操作>` — 期望结果
- [ ] `<命令或操作>` — 期望结果
- ...

例：
- [ ] `alembic upgrade head && alembic downgrade base` 双向迁移无错
- [ ] `pytest tests/test_rls.py::test_cross_tenant_blocked` PASS
- [ ] `pytest tests/test_rls.py::test_same_tenant_allowed` PASS

## 上游（必填）
读完这些再开工。**只读，不改**。

- `<path/to/spec.md>` — 关注 §X 段
- `<path/to/architecture.md>` — 关注 §Y 段
- `<path/to/harness-plan.md>` — 关注 Batch N

## 下游（推荐）
- 消费方 WO-XXX（worker 名字）会读 `<path/to/your/output>`

## 约束（可选）
- 命名：表名 / 模块名必须以 `xxx_` 开头
- 技术栈：必须用 X，不要用 Y
- 风格：遵循 `<style.md>` 第 N 条
- 性能：API p95 < 200ms

## 优先级 / 截止（可选）
- P0 / P1 / P2
- Walker 预算：<X> 分钟

## 备注（可选）
- 已知风险
- 临时性指示
- 之前 WO 的遗留问题

---

# Report Template

> Worker 干完活后写到 `.shadow/iterations/iter-N/work-orders/<task_id>/report.md`。
> **只回报，不解释过程**。

---

# Worker Report: <task_id>

## 状态
🟢 done / 🟡 partial / 🔴 blocked / ❌ failed

## 产出
- `<path>` (新)
- `<path>` (改)
- `<path>` (删)

## 验收
- [x] <criterion 1> — PASS — <一行证据>
- [x] <criterion 2> — PASS — <一行证据>
- [ ] <criterion 3> — 未达 — <原因>

## 卡点 / 风险
（仅 status != done 时填）
- 卡在哪
- 已尝试的方案
- 需要 walker 做什么

## 偏差
（仅实现和 spec/arch 不一致时填）
- **spec/arch 怎么说的**：<引用>
- **我实际怎么做的**：<描述>
- **建议 walker 怎么办**：接受偏差（更新 spec） / 拒绝偏差（我重做）

## 建议下一步
- [ ] 派 WO-XXX 给 worker 收尾
- [ ] 调 spec RXX（接受偏差）
- [ ] 跑 shadow-reviewer 复查
- [ ] 其他

## 用时
X 分钟（用作 walker 的 effort baseline）

---

# Walker 派活清单（quick reference）

派活前 walker 自检：
- [ ] 任务边界清晰，scope 写了 in / out
- [ ] 验收可执行（不是"代码质量高"这种）
- [ ] 上游 artifact 路径都给了
- [ ] 下游消费者提了（如果有）
- [ ] 约束（命名/技术栈）写了
- [ ] work order 文件已写入 `.shadow/iterations/iter-N/work-orders/<task_id>.md`
- [ ] 文件名规范：`WO-NNN-slug.md`（NNN 3 位数字，slug 小写连字符）

收活时 walker 自检：
- [ ] report.md 存在且 status 不是 failed
- [ ] 验收每条都过（partial 也行，但要明确哪条没过）
- [ ] 偏差段：如果有偏差，决定接受 / 拒绝
- [ ] 卡点段：如果有卡点，决定派新 WO / 改 spec / 升级到上游
- [ ] 下一个 WO / 下一阶段
