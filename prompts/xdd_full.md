# xdd 全流程

xdd 6 Phase 完整 prompt — 在外部产品项目 (`.xdd/` 存在) 里使用, 触发方式: 调 xdd-walker agent 或直接说"用 xdd 流程开发".

---

## Phase 0: INIT — 初始化

**目标：** 准备好骨架 (`.xdd/` 目录 + status.md + scale.md + iter-1/)。

**步骤**:

1. 检测 `.xdd/` 是否存在
2. 不存在 → 跑 `xdd-init` skill 生成骨架
3. 检查 scale.md `strict_mode` 字段 (默认 true, 决定下游 skill 行为)

### Gate 0: INIT → RESEARCH

- [ ] `.xdd/` 存在
- [ ] scale.md 字段齐全 (含 strict_mode, l0_required, l3_required, l6_required)
- [ ] status.md 12 行阶段表全部 ⏳ (除 Phase 0 已 ✅)

---

## Phase 1: RESEARCH — 理解与对齐

**目标：** 明确要做什么, 找到代码/设计中的接入点。

**步骤**:

1. **理解用户真实需求**
2. **读现有 `.xdd` 工件和代码**
   - `.xdd/core/intent.md` (用户意图)
   - `.xdd/project.flow.mermaid` (系统组件拓扑)
   - `.xdd/bdd/` (已有 BDD 场景)
   - `.xdd/wire/` (已有页面, 如有)
   - 相关源代码
3. **任务分类**: 新增 / 修改 / 重构 / Bugfix
4. **确定影响范围**: 哪些 `.xdd` 工件需要创建/修改

### Gate 1: RESEARCH → DESIGN

- [ ] 需求边界清晰
- [ ] 任务类型已定
- [ ] 需要修改的 `.xdd` 工件清单已列出
- [ ] 严格按 `scale.l0_required` 决策是否调 xdd-l0 skill (strict_mode=true 时 M+ 强制)
- [ ] 严格按 `scale.bxx_enabled` 决策是否做 BXX 业务线拆分 (bizline_count > 1 时强制)

---

## Phase 2: DESIGN — 更新 `.xdd` 工件

**目标：** 按依赖顺序更新设计工件。每个子阶段调用对应 skill。

### Step 2.1: 更新 BDD (必做)

```
加载 skill("xdd-bdd") → 按规范写 .xdd/bdd/<feature>.feature
```

- 多类型/多状态用 Scenario Outline + Examples
- Then 断言可观察 (前端/后端/存储边界明确)
- 至少 1 个异常路径

**Gate 2.1:** 跑 xdd-bdd 质量清单 (12 项) 通过

### Step 2.2: 更新 Flow (如需)

```
加载 skill("xdd-flow") → 按规范修改 .xdd/project.flow.mermaid
```

- BXX-NYY 节点编号
- 标注协议 (HTTP/gRPC/RPC) + Payload

**Gate 2.2:** `mmdc -i .xdd/project.flow.mermaid -o /tmp/flow-check.svg` 可渲染

### Step 2.3: 更新 ADD (如需)

```
加载 skill("xdd-add") → 按规范写 .xdd/add/
```

- 状态机 `stateDiagram-v2`
- 核心时序图 `sequenceDiagram`
- 启动/关闭序列
- 排障锚点

**Gate 2.3:** ADD 12 段模板齐全

### Step 2.4: 更新 Wire (UI 变更时)

```
加载 skill("xdd-wire") → 按规范写 .xdd/wire/<page>.svg
```

- desktop + mobile 双 SVG
- design tokens 标注
- 零 em-dash

**Gate 2.4:** xdd-wire 预检清单 (35 项) 通过

### Step 2.5: Arch (scale ≥ M 触发, strict_mode=true 全规模)

```
加载 skill("xdd-arch") → 写 .xdd/L1.5-architecture/{slug}/architecture.md
                         + aggregate-landscape.md
                         + event-contract.md
```

- API 端点清单 (前后端数据契约)
- 安全设计 (SDD) / 性能设计 (PDD) 独立段

**Gate 2.5:** 5 个工件都跑过 mmdc / Gherkin parse 验证

---

## Phase 2.5 BDD (含在 Phase 2 中)

BDD 在 Phase 2.1 必做, 这里特指 Design-Conformance Gherkin (v9.2):
- Given 段必引 spec.md §RXX line (业务约束翻译成可测试 step)
- 反向场景 + 正向场景都要写

---

## Phase 2.7: SCAFFOLD (新项目触发)

```
加载 skill("xdd-scaffold") → 7 步 Docker 开发环境
```

- 目录骨架 → 开发依赖 → 测试框架 → 服务依赖 (Docker) → DB 迁移 → Hello API → Smoke Test
- 产出: 可 TDD 的 Docker 环境 + 全链路 Hello API

**Gate 2.7:**
- `docker run` 基础容器成功
- 目录骨架符合 core.md

---

## Phase 3: REVIEW — 用户审查

**目标：** 用户确认设计变更后再进入实现阶段。

### 步骤

1. 展示变更: `git diff .xdd/`
2. 按工件类型分组展示 (Flow / Arch / ADD / BDD / Wire)
3. 等待用户明确确认

> 以上是 `.xdd` 设计变更. 请确认是否可以进入实现计划阶段?

### Gate 3: REVIEW → PLAN

- [ ] 用户输入"确认" / "OK" / "继续" / "go"
- [ ] 如有修改意见 → 回 Phase 2

---

## Phase 4: PLAN — 生成 TDD 实施计划

```
加载 skill("xdd-plan") → 按规范生成 docs/xdd/plan/<feature>.md
```

### 步骤

1. 读 BDD / ADD / Arch / Flow / Wire
2. 每个 BDD Scenario → 1 个或多个 Task
3. Task 2-5 分钟单动作, ≤ 7 步
4. Task 间依赖关系 (DAG, 无环)
5. BDD 覆盖追踪表
6. 保存到 `docs/xdd/plan/<feature>.md`

### Gate 4: PLAN → EXECUTE

- [ ] xdd-plan 17 项自检通过
- [ ] 无 TBD/TODO/空话
- [ ] BDD 覆盖追踪表完整
- [ ] 依赖关系无环

---

## Phase 5: EXECUTE — 执行计划

```
加载 skill("xdd-execute") → 按规范执行计划
```

### 执行模式

- **逐任务分派 (推荐)** — 每个 Task 派发独立子代理
- **内联执行** — 当前会话串行

### 核心规则

1. 严格按 Step 执行, 不跳过验证步骤
2. 每 Step 更新 checkbox `[ ]` → `[~]` → `[x]`
3. 每 Task 提交一次
4. 阻塞即停, 不猜测

### Gate 5: EXECUTE → VERIFY

- [ ] 全量测试通过
- [ ] BDD 覆盖追踪表全部 `[x]`

---

## Phase 6: VERIFY — 收尾与报告

### 步骤

1. 运行全量测试
2. 检查 BDD 覆盖
3. 检查 git log
4. 4 维 L5 一致性审计 (spec↔code / wire↔code / arch↔code / l3↔code)
5. **L6 子阶段 (l6_required=true)**: 跑 xdd-l6 (health-check / wander-test / production-scenarios)
6. 输出执行报告

### Gate 6: VERIFY → DONE

- [ ] 全量测试 PASS
- [ ] L5 4 维审计 PASS
- [ ] 部署子阶段: 烟雾测试通过

---

## 快速路由

根据任务类型跳过不需要的 Phase:

| 任务类型 | 跳过的 Phase |
|---------|--------------|
| 纯 bugfix (不改设计) | Phase 2, 3 → 直接进 Phase 4 |
| 纯重构 (不改行为) | Phase 2 (bdd), 3 → 只更新 add (如需) |
| 新功能 (完整流程) | 全部执行 |
| 只改 UI | Phase 2 (add 可能不需要), 3 |

---

## 文件结构约定

```
.xdd/
  project.flow.mermaid          # 系统架构流程图
  add/                          # 架构设计说明书
  bdd/                          # 业务蓝图 / Gherkin
  wire/                         # UI wireframe SVG

docs/xdd/plan/
  <feature>.md                  # TDD 实施计划
```

---

## 禁止行为

- 不得跳过任何 Gate 检查
- 不得在不加载对应 skill 的情况下生成 xdd 工件
- 不得在 Phase 3 用户未确认的情况下进入 Phase 4/5
- 不得在 main/master 上直接开发
- 不得自行修改计划结构
- 不得输出 TBD/TODO/空话占位符
- 不得跳过验证步骤或提交步骤
