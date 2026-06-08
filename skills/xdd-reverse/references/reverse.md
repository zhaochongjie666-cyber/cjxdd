---
name: reverse
description: |
  [Internal] Reverse Worker — reverse-engineers .shadow/ from existing code (L5 back to L1). Dispatched from the main `shadow` skill. Do not trigger directly.
version: 1.0
---

# Shadow Reverse Worker — 逆向反推

## 角色职责

从现有代码仓库（L5）反向构建完整的 Shadow 层级产物，产出物顺序：`L5 扫描` → `L4 推导` → `L3 映射` → `L1.5 推断` → `L1 重建`。

> **核心原则**：代码是唯一的真相（Code is the Source of Truth）。反推产物必须忠实反映现有代码，而非理想化重构。

## 变量

| 变量 | 来源 | 示例 |
|------|------|------|
| `{{PROJECT_DIR}}` | 项目目录 | `/root/ws/my-project` |
| `{{SLUG}}` | 业务 slug（可多条） | `user-registration` |
| `{{MODE}}` | `full`（全量反推）或 `incremental`（增量反推） | `full` |
| `{{SCOPE}}` | 反推范围（目录/模块） | `src/user/`, `src/payment/` |
| `{{TARGET_LAYER}}` | 反推目标层（默认推到 L1） | `L1` |

## 适用场景

| 场景 | 说明 |
|------|------|
| 接手遗留项目 | 无设计文档，只有代码，需要理解业务全貌 |
| 构建影子仓库 | 已有项目要接入 Shadow 流程，需要先反推建立 `.shadow/` 基线 |
| 设计漂移检测 | 定期反推对比已有 L1 spec，发现代码与设计的偏差 |
| 代码审计/交接 | 新成员接手时快速理解系统架构和业务流 |

## 执行步骤

### 全量反推模式（MODE=full）

**三阶段策略：先骨架，再证据化，最后 Git 审计。**

> **为什么三阶段？** 单次全量反推容易遗漏细节、过度推断。分阶段确保：Phase A 快速建立全局视图，Phase B 逐线深入有据可查，Phase C 用 Git 历史补充时序和变更意图。
>
> **核心原则**：不创建 R 专属模板。每层产出直接复用对应 L 层的产出格式，写入 `.shadow/` 对应层目录：
> - L1 → `.shadow/business/BXX-{slug}/`
> - L1.5 → `.shadow/arch/BXX-{slug}/`
> - L2 → `.shadow/L2-e2e/BXX-{slug}/`
> - L6 → `{迭代作用域}/verify/{slug}/`（注：`{迭代作用域}` = `.shadow/iterations/{当前迭代}`）

---

#### Phase A: 结构骨架生成（快速，覆盖广）

**目标**：快速扫描代码库，生成所有层的骨架结构。粗粒度，覆盖全，允许 LOW 置信度。

##### Step A1: L5 扫描 — 代码资产盘点

```
[扫描目标]
  ├── 语言/框架识别（package.json / requirements.txt / go.mod）
  ├── 目录结构分析（src/, test/, config/, scripts/）
  ├── 入口点定位（main.py / index.js / App.tsx）
  ├── 依赖图构建（import/require 关系）
  └── 代码规模统计（文件数/行数/模块数）
```

**产出**：内部扫描报告（不写入 .shadow/），仅作为后续反推的输入。

##### Step A2: 业务线识别 + L1~L1.5 骨架

1. **业务线划分**：读取 `references/r-bizline-detector.md`，按模块/目录识别业务线，分配 BXX 编号
2. **L1 骨架流程图**：为每条业务线生成 **粗粒度骨架** project.flow.mermaid
   - 仅含主要路径（happy path + 1-2 条关键异常路径）
   - 节点用 `[CONF: LOW]` 占位
   - 目标是建立全局拓扑，不要求完整
3. **L1.5 架构骨架**：生成 architecture.md + file-list.md + quality.md 的初始版本
4. **Harness 计划**：生成 plan.md 初始版本
5. **L4 骨架**：识别已有测试文件或标注「推导」占位

**Phase A 产出**：
- `.shadow/` 目录结构已建立
- 每条业务线有骨架 project.flow.mermaid（粗粒度，LOW 置信度为主）
- L1.5/L3/L4 有初始占位文件
- **业务线清单**：哪些线需要 Phase B 深入

##### Step A Gate（骨架完整性 — 诚实审计）

**审计结论分类**：PASS（有证据确认）| WARN（有缺口但不阻塞）| BLOCK（关键缺失，必须补全）

| # | 检查项 | 审计标准 | 结论 |
|---|--------|---------|------|
| A1 | .shadow/ 目录结构 | L1/L1.5/L3/L4 目录已创建 | PASS/LOADING |
| A2 | 业务线识别 | 模块/目录扫描，列出已识别和未归类模块 | PASS/WARN(有未归类模块)/BLOCK(0条线) |
| A3 | 骨架 flow | 每条业务线有粗粒度流程图 | PASS/WARN(某线缺失)/BLOCK(主业务线缺失) |
| A4 | 置信度标注 | 骨架节点全部标为 `[CONF: LOW]` | PASS/WARN(部分未标注) |
| A5 | L1.5 骨架 | architecture.md + file-list.md 已生成 | PASS/BLOCK(缺失) |

**Phase A 审计结论规则**：
- 全部 PASS → 进入 Phase B
- 有 WARN → 记录缺口，仍可进入 Phase B（缺口在 Phase B 补全）
- 有 BLOCK → 停止，必须先修复 BLOCK 项

---

#### Phase B: 逐业务线证据化补全（深入，有据可查）

**目标**：对每条业务线逐一深入，用代码证据将骨架升级为完整产物。一次只处理一条业务线。

##### 执行方式

```
FOR EACH 业务线 BXX IN 业务线清单（按重要性降序）:
  Step B1: 深入阅读该业务线的所有源码文件
  Step B2: 按 r-flow-rebuilder.md 7 Phase 执行完整流程图反推
  Step B3: 用代码证据（函数签名、try-catch、状态字段）标注置信度
  Step B4: 更新 spec.md / research.md / wire 产物
  Step B5: 更新 plan.md（L5 Plan 出精密执行计划）
  Step B6: 运行业务线 Gate 检查
  → 通过 → 标记该业务线为「证据化完成」
  → 失败 → 修正（≤3次）→ 失败则降级为 LOW 并继续下一条
NEXT 业务线
```

##### Step B1: 源码精读

对该业务线涉及的所有文件逐个阅读：
- 提取所有函数签名和调用关系
- 提取所有 if/else/try-catch/guard 分支
- 提取所有状态字段和转换逻辑
- 提取所有外部调用（DB/HTTP/MQ/IO）

##### Step B2: 完整流程图反推

读取 `references/r-flow-rebuilder.md` 完整文件后执行 7 Phase：
1. 入口点发现 → 2. 调用链追踪 → 3. 异常分支发现 → 4. 状态机还原 → 5. 业务线拆分 → 6. Mermaid 生成 → 7. 置信度标注

**核心约束**：反推流程图必须达到正向 L1 的质量标准——BXX-NYY 编号、异常分支、状态转换、多业务线 subgraph、L1 配色。禁止生成简单线性流程。

##### Step B3: 证据化置信度升级

```
骨架节点 [CONF: LOW]
  ↓ 找到函数实现 → [CONF: HIGH]
  ↓ 找到代码结构暗示 → [CONF: MEDIUM]
  ↓ 无证据 → 保持 [CONF: LOW]

证据来源：
  ├── 函数体/路由处理器 → HIGH
  ├── 测试用例覆盖 → HIGH
  ├── 错误处理模式（try-catch/guard）→ HIGH
  ├── 命名约定暗示 → MEDIUM
  ├── 代码结构暗示 → MEDIUM
  └── 无直接证据 → LOW
```

##### Step B4: L1 产出补全

**产出**：参考 `../../layers/l1/templates/L1.md` 与 `../../layers/l1/templates/mermaid.md`
- `research.md` — 按 L1 调研格式
- `.shadow/business/project.flow.mermaid` — 项目级唯一 BXX-NYY 编号流程总图（含多业务域 subgraph、异常分支、状态标注）
- `spec.md` — 按 L1 规格格式，生成 `{{SLUG}}-R01` 格式规则 ID，含状态转换和异常处理
- `wire.svg` — UI 线框图主产物（如为前端项目，按 L1 SVG 线框图格式）

##### Step B5: L3/L4/L1.5 同步更新

- **L3**：从完整流程图更新 plan.md（精确到 @implements 对应规则 ID）
- **L4**：从 spec.md 规则推导测试场景，更新测试代码
- **L1.5**：从完整流程图更新 file-list.md（精确到文件-规则映射）和 api-contract.yaml

##### Step B6: 诚实审计（逐业务线）

**每条业务线必须输出证据明细表**，审计结论基于证据而非主观判断：

```markdown
## BXX {业务线名称} — 证据审计明细

| 节点 | 节点类型 | 代码证据 | Git 证据 | 测试覆盖 | 置信度 | 审计结论 |
|------|---------|---------|---------|---------|--------|---------|
| B01-N03 | 动作节点 | POST /api/register (server/routes.ts:42) | abc1234 "add register" | test_register.py::test_create | HIGH | ✅ PASS |
| B01-N04 | 分支节点 | if user.exists() (server/routes.ts:45) | — | test_register.py::test_duplicate | HIGH | ✅ PASS |
| B01-N05 | 后台执行 | send_email() (server/mail.ts:12) | def5678 "add email" | ❌ 无测试 | MEDIUM | ⚠️ WARN: 缺少邮件发送测试 |
| B01-N08 | 异常节点 | catch DBError (server/routes.ts:50) | — | ❌ 无测试 | LOW | 🔴 BLOCK: DB 错误处理无测试覆盖 |
| B01-S02 | 状态机 | status=PENDING (server/models.py:15) | — | test_status.py::test_transition | HIGH | ✅ PASS |
```

**审计结论判定规则**：

| 条件 | 结论 | 说明 |
|------|------|------|
| 有代码证据 + 有测试覆盖 | ✅ PASS | 证据充分，可信赖 |
| 有代码证据 + 无测试 | ⚠️ WARN | 逻辑存在但未验证，建议补充测试 |
| 有代码证据 + 测试只覆盖 happy path | ⚠️ WARN | 异常路径未测，建议补充 |
| 无代码证据 + 从结构推断 | ⚠️ WARN | 推断产物，标记 [CONF: MEDIUM] |
| 代码有 try-catch 但无对应异常测试 | 🔴 BLOCK | 错误处理是代码明确写的，缺测试不可接受 |
| 状态机有定义但无状态转换测试 | 🔴 BLOCK | 状态机是核心逻辑，缺测试不可接受 |
| 外部调用（HTTP/MQ/DB）无 mock 测试 | ⚠️ WARN | 外部依赖缺 mock，建议补充 |
| 无法从代码找到对应节点 | 🔴 BLOCK | 反推出的节点在代码中无证据，需修正流程图 |

**业务线整体审计结论**：

```
IF 该线所有节点 → ✅ PASS
  → 业务线标记为「审计通过」
ELIF 存在 ⚠️ WARN 但无 🔴 BLOCK
  → 业务线标记为「审计通过（有测试缺口）」
  → 输出测试缺口清单供后续补充
ELIF 存在 🔴 BLOCK
  → 业务线标记为「审计阻塞」
  → 必须修正或补充证据后重新审计
  → 修正 ≤3 次，超限则降级该节点为 [CONF: LOW] 并继续
```

##### Phase B Gate 汇总（跨业务线）

| # | 检查项 | 审计标准 | 结论 |
|---|--------|---------|------|
| F1 | BXX-NYY 编号 | 每个节点有唯一编号 | PASS/WARN(编号不连续) |
| F2 | 6类节点齐全 | 阶段/分支/异常/状态机/后台/前端 都有对应节点 | PASS/WARN(某类缺失) |
| F3 | 异常分支覆盖 | 关键动作节点有异常处理分支 | PASS/WARN(部分缺)/BLOCK(全部缺) |
| F4 | 状态转换标注 | 有 S→S 变化的节点已标注 | PASS/WARN(部分未标) |
| F5 | 跨线连接 | 经过接口节点，有标签 | PASS/WARN(标签缺失) |
| F6 | L1 配色 | 使用 classDef 配色 | PASS/BLOCK(未使用) |
| F7 | 置信度分布 | HIGH ≥ 60%, LOW ≤ 10% | PASS/WARN(LOW 偏高) |
| F8 | 节点描述 | 具体动作描述 | PASS/BLOCK(模糊命名) |
| F9 | 证据明细表 | 每条业务线都有 | PASS/BLOCK(缺失) |
| F10 | 代码证据链 | 每个节点可追溯到代码文件:行号 | PASS/WARN(部分无法追溯) |
| F11 | 测试缺口清单 | WARN/BLOCK 项已列出 | PASS/WARN(有缺口) |

---

#### Phase C: Git 审计（时序补全 + 变更意图推断）

**目标**：利用 Git 历史为反推产物补充时序信息和变更意图，提升置信度。

##### Step C1: 变更历史扫描

```bash
# 获取项目整体变更节奏
git log --oneline --since="6 months ago" --format="%h %ai %s"

# 获取每条业务线的变更频率
git log --oneline -- <业务线目录>/

# 获取关键文件的变更历史
git log --follow --oneline -- <关键文件>
```

**产出**：变更时间线，识别热点模块和高频变更文件。

##### Step C2: 意图推断（Blame + Commit Message）

```bash
# 关键函数的变更意图
git blame -f <文件> | grep -A2 <关键函数>

# 特定功能点的引入时间和原因
git log --all-match --grep="<功能关键词>" --oneline
```

**推断规则**：

| Git 证据 | 推断 | 置信度影响 |
|---------|------|-----------|
| 有明确 commit message 说明功能 | 变更意图明确 | LOW → MEDIUM 或 MEDIUM → HIGH |
| blame 显示最近修改 | 活跃功能，推断更可靠 | 保持或提升 |
| 大量 commit 但频繁修改 | 不稳定区域，推断可能不准 | 降低一级 |
| 长期未修改的代码 | 稳定功能，推断较可靠 | 保持或提升 |
| commit 引入 try-catch | 错误处理是有意为之 | 推断确认 → HIGH |

##### Step C3: 时序标注

在 spec.md 中补充变更历史信息：

```markdown
| 规则 ID | 描述 | ... | Git 历史 |
|---------|------|-----|---------|
| R01 | ... | ... | 引入: abc1234 (2025-01-15) "add email validation" |
| R02 | ... | ... | 活跃: 最近 3 月 5 次修改 |
```

##### Step C4: 置信度终审

```
对所有仍为 [CONF: MEDIUM] 的节点：
  → Git 证据能确认 → 升级为 HIGH
  → Git 证据矛盾 → 降级为 LOW + 标注 ASSUME
  → 无 Git 证据 → 保持 MEDIUM

目标：最终产物中 HIGH ≥ 60%, MEDIUM ≤ 30%, LOW ≤ 10%
```

##### Phase C Gate（Git 审计 — 诚实审计）

| # | 检查项 | 审计标准 | 结论 |
|---|--------|---------|------|
| G1 | 变更历史扫描 | 所有业务线目录已扫描 git log | PASS/WARN(部分目录未扫) |
| G2 | 热点标注 | 高频变更文件已标注 | PASS/WARN(未标注) |
| G3 | 置信度终审 | HIGH ≥ 60%, LOW ≤ 10% | PASS/WARN(LOW 偏高)/BLOCK(LOW > 30%) |
| G4 | Git 历史 column | spec.md 规则表含 Git 历史 | PASS/WARN(部分缺) |
| G5 | 时序一致 | flow 节点顺序与代码引入时间无矛盾 | PASS/WARN(有矛盾需标注) |
| G6 | 证据明细 Git 补充 | 证据明细表中 Git 证据列已填写 | PASS/WARN(部分未填) |

**最终审计报告**：Phase A/B/C 完成后，生成全量审计报告：

```markdown
# 反推审计报告

## 总体结论
- 业务线总数: N
- ✅ 审计通过: M 条
- ⚠️ 有测试缺口: K 条
- 🔴 审计阻塞: J 条

## 逐业务线审计结论
| 业务线 | 节点数 | PASS | WARN | BLOCK | 置信度分布 | 整体结论 |
|--------|-------|------|------|-------|-----------|---------|
| B01-xxx | 15 | 12 | 2 | 1 | H:60% M:27% L:13% | ⚠️ 有测试缺口 |
| B02-yyy | 8 | 8 | 0 | 0 | H:75% M:25% L:0% | ✅ 审计通过 |

## 测试缺口汇总（需后续补充）
- B01-N05: 邮件发送无测试 → 建议: 补充 test_send_email mock 测试
- B01-N08: DB 错误处理无测试 → 建议: 补充 test_db_error 场景测试
```

---

#### 三阶段总览

```
Phase A: 骨架（快）
  ├── A1: L5 扫描
  ├── A2: 业务线识别 + L1~Harness 计划
  └── A Gate: 结构完整性

Phase B: 证据化（深）— 逐业务线
  ├── B1: 源码精读
  ├── B2: 完整流程图反推（r-flow-rebuilder.md 7 Phase）
  ├── B3: 置信度升级
  ├── B4: L1 产出补全
  ├── B5: L3/L4/L1.5 同步
  └── B Gate: F1-F9 质量门禁

Phase C: Git 审计（补）
  ├── C1: 变更历史扫描
  ├── C2: 意图推断（blame + commit msg）
  ├── C3: 时序标注
  ├── C4: 置信度终审
  └── C Gate: G1-G5 审计完整性
```

### 增量反推模式（MODE=incremental）

```
1. 读取现有 .shadow/ 目录，获取已有 L1/L1.5/L3 产物
2. 扫描代码变更部分（git diff 或文件 mtime）
3. 仅反推受影响的部分
4. 对比已有产物 → 标记差异
5. 输出差异报告 → 更新 .shadow/ 文件
```

**适用场景**：定期同步、设计漂移检测、已有影子仓库的维护。

## 反推置信度标注

反推产物必须标注置信度，帮助后续开发判断可靠程度：

| 等级 | 标记 | 含义 | 来源 |
|------|------|------|------|
| HIGH | ✅ | 代码直接证明 | 测试覆盖、明确的路由/接口定义 |
| MEDIUM | ⚠️ | 合理推断 | 代码结构暗示、命名约定暗示 |
| LOW | ❓ | 猜测/ASSUME | 无直接证据，按行业惯例推测 |

**标注格式**：在每条规则/每个节点后标注 `[CONF: HIGH/MEDIUM/LOW]`

```markdown
- user-registration-R01: 用户通过邮箱注册 [CONF: HIGH] ← 有测试覆盖
- user-registration-R02: 注册后发送验证邮件 [CONF: MEDIUM] ← 有邮件服务调用，但无测试
- user-registration-R03: 注册后自动创建免费试用 [CONF: LOW] ← 按 SaaS 惯例推测
```

## 业务线自动识别

反推过程中自动识别业务线（biz-{id}）：

```
[扫描模块/目录]
  ↓
{模块名/目录名是否暗示业务领域？}
  ├─ user/auth/profile → biz-user
  ├─ payment/billing/checkout → biz-payment
  ├─ order/cart/shipping → biz-order
  ├─ notification/email/sms → biz-notification
  └─ 其他 → 根据模块职责归类

[验证]
  → 检查模块间调用关系，确认业务线边界
  → 跨模块调用 → 标记为跨线连接
```

## Gate 检查

反推完成后，复用各层原有 Gate 检查：

| 层 | Gate 检查 | 脚本/标准 |
|----|----------|----------|
| L1 | 流程/规格完整性 | 复用 `layers/l1/L1.md` 与 `layers/l1/references/gate-l1.md` 的 Gate 标准 |
| L1.5 | 架构覆盖 | 复用 `layers/l1p5/L1.5.md` 与 `layers/l1p5/references/gate-l1p5.md` 的 Gate 标准 |
| L3 | 骨架完整性 | 复用 `layers/l2.5-fdd/L3.md` 与 `layers/l2.5-fdd/references/gate-l3.md` 的 Gate 标准（已废弃，L3 由 Harness 计划替代） |
| L4 | 测试场景覆盖 | 复用 `layers/l4/L4.md` 与 `layers/l4/references/gate-l4.md` 的 Gate 标准（已废弃，L4 由 Harness 计划测试断言替代） |

**额外反推专属检查：**

| # | 检查项 | 通过标准 |
|---|--------|---------|
| R1 | 代码扫描完整 | 所有源文件目录已扫描，无遗漏 |
| R2 | 流程可追踪 | project.flow.mermaid 中每条路径都能在代码中找到对应 |
| R3 | 各层 Gate 通过 | L1/L1.5/L3/L4 各自 layer-gate-guard 通过 |
| R4 | 置信度标注 | L1 spec 每条规则都有 [CONF: ...] 标记 |
| R5 | 层间一致性 | L1 spec → L1.5 架构 → Harness 计划 → L5 代码 可追溯 |
| R6 | 流程图质量 | F1-F11 所有审计项有结论（PASS/WARN/BLOCK） |
| R7 | 异常分支完整 | 关键动作节点有异常处理分支 |
| R8 | 状态机还原 | 识别到状态模式的代码已还原为状态表 + 节点标注 |
| R9 | 证据明细表 | 每条业务线有证据明细表，包含代码证据和 Git 证据 |
| R10 | 测试缺口清单 | WARN/BLOCK 项已汇总为可执行的测试补充清单 |

## 修正策略

| 尝试轮次 | 策略 |
|---------|------|
| 1-2 | 逐条修正 FAIL 项，补充缺失推导 |
| 3-4 | 重新审视推导逻辑，从代码根因出发 |
| 5+ | 调整反推范围（SCOPE），缩小聚焦核心模块 |

## 关键约束

- **代码是唯一真相**：反推产物必须忠实反映现有代码，不得添加代码中不存在的逻辑
- **不确定性标注**：无法确定的部分用 `[CONF: LOW]` + ASSUME 标注，不得隐瞒
- **不重构代码**：反推阶段不修改任何业务代码，只做分析和推导
- **保持原始命名**：提取的规则/模块名尽量使用代码中的原始命名
- **多 slug 支持**：一个仓库可能包含多条业务线，每条业务线独立产出
- **完成后不声称完成**：等协调器独立 Review

## 与正向流程的衔接

反推完成后，后续开发回归正向：

```
反推完成 → .shadow/ 建立基线
                ↓
      后续新需求 → L1 → L1.5 → ... → L5（正常正向）
                ↓
      已有代码修改 → 增量反推 → 检测漂移 → 修正 .shadow/
```

## 参考文件

| 文件 | 用途 | 何时读 |
|------|------|--------|
| `references/r-code-scanner.md` | 代码扫描策略 + 语言适配 | Phase A Step A1 |
| `references/r-flow-rebuilder.md` | 完整流程图反推规则（7 Phase） | Phase B Step B2 |
| `references/r-bizline-detector.md` | 业务线自动识别规则 | Phase A Step A2 |
| `../../layers/l1/templates/L1.md` | L1 产出格式 | Phase B Step B4 |
| `../../layers/l1/templates/mermaid.md` | L1 flow 产出格式 | Phase B Step B2/B4 |
| `../../layers/l1p5/templates/L1.5.md` | L1.5 产出格式 | Phase A Step A2 / Phase B Step B5 |
| `../../layers/l2.5-fdd/templates/L3.md` | （已废弃，L3 由 Harness 计划替代） | Phase A Step A2 / Phase B Step B5 |
| `../../layers/l4/templates/L4.md` | （已废弃，L4 由 Harness 计划测试断言替代） | Phase A Step A2 / Phase B Step B5 |
