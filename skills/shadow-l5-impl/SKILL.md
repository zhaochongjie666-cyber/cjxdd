---
name: shadow-l5-impl
alias: Shadow·L5-Impl
description: |
  Shadow L5 代码实现 — 基于 Harness 计划的机械执行。
  AI coder 只读 Harness 计划，不需要任何上游文档，按 Batch 逐文件实现。
  生产实现必须满足真正可用契约：真实持久化、真实认证、跨服务数据流。
  触发：L5、实现、代码、TDD、Harness。
version: "5.0.0"
---

# Shadow·L5 — Harness 计划执行者

## 角色

**只读 Harness 计划，机械执行。** 不需要理解架构全局，不需要读上游文档。

Harness 计划是唯一的输入源。它包含了 coder 需要的一切：
- 每个文件的类签名、方法签名、字段类型
- 每个方法的校验条件、状态变更、事件发布
- 每个方法的测试断言
- 错误码、错误消息
- 依赖服务的接口签名

## 怎么做

### 1. 读 Harness 计划

读取 `.shadow/L5-plan/{slug}/harness-plan.md`。

不需要读其他任何文件。

### 2. 领域模型一致性检查

在写任何代码前，对照 Harness 计划中的聚合定义检查理解：

```
聚合根类名 → 与 Harness 计划一致？
聚合边界 → 包含/不包含与 Harness 计划一致？
跨聚合引用 → ID 引用而非对象嵌入？
一致性边界 → 强一致/最终一致与 Harness 计划一致？
```

### 3. TDD 循环（按 Batch 逐文件）

以 **Batch** 为单位串行执行，Batch 内文件可并行：

```
对每个 Batch:
  对该 Batch 内每个文件:
    1. 找到 Harness 计划中该文件的实现指令
    2. 先写测试（Harness 计划中的测试断言）
    3. 写最小实现让测试通过
    4. 重构（保持测试通过）
  该 Batch 全部完成后，运行该 Batch 的全部测试验证
```

**文件完成定义**：
- Harness 计划中该文件的所有测试全 GREEN
- Harness 计划中该文件的所有方法都有实现
- 无存根代码（禁止 pass、return None、TODO）

### 4. 文件头（追溯强制）

#### 后端实现文件

```python
"""
File: backend/app/services/user_service.py
L1: user-service (.shadow/L1-business/BXX-user-service/)
L5-Plan: .shadow/L5-plan/user-service/harness-plan.md
@implements: user-service-R01 (B01-N03), user-service-R02 (B01-N04)
@intent: 管理员需要管理用户信息和角色分配
"""
```

#### 前端实现文件

```typescript
/**
 * File: frontend/src/pages/AnnotatorWorkbench.tsx
 * L1: annotation-platform (.shadow/L1-business/B01-annotation-platform/)
 * L5-Plan: .shadow/L5-plan/annotation-platform/harness-plan.md
 * @implements: annotation-R11, annotation-R12, annotation-R13, annotation-R14, annotation-R15
 * @intent: 标注员需要在一个页面内完成完整标注工作流
 * @page: AnnotatorWorkbench
 * @route: /tasks/:taskId/annotate
 */
```

**追溯要求**：
- 每条 spec 规则必须在某个实现文件的 @implements 中出现
- @implements 引用的规则必须在 spec.md 中存在
- 每个实现文件必须包含 @intent
- 每个前端页面/组件必须与 wire.svg 交互区域对应

## 产出

项目目录下的实现代码文件（后端 + 前端）+ 测试代码文件。

## 约束

- **只读 Harness 计划**，不读 L1 spec 等上游文档
- @implements 必须与 Harness 计划中标注的规则一致
- @intent 必须与 Harness 计划一致
- 无存根代码（禁止 pass、return None、TODO）
- 无硬编码 secret
- 无生产路径内存仓库
- 无假登录或硬编码用户
- 前端必须实现 Harness 计划中定义的所有 state/actions/events
- 按 Batch 顺序执行，一个 Batch 未完成前不可进入下一个
- **先写测试再写实现**（TDD：测试断言来自 Harness 计划）

## 代码品味约束

- [ ] 函数 ≤ 20 行，参数 ≤ 3 个
- [ ] 无 Code Smell（嵌套 ≤ 2 层，无重复 ≥ 3 处，无魔法数字）
- [ ] 错误不吞、可发现、可解释

## L5 门禁检查

### 层内自检

完成后运行 L5 门禁检查。门禁详细说明见 `references/gate-l5.md`，语义 gate 报告模板见 `references/l5-semantic-gate-report-template.md`。

执行下方 L5 门禁检查。检查 Harness 计划覆盖度、实现完整性、追溯完整性。

### 门禁检查项

#### Harness 计划覆盖度
1. Harness 计划存在（.shadow/L5-plan/{slug}/harness-plan.md）
2. Harness 计划中列出的所有文件都有实现
3. Harness 计划中列出的所有方法都有对应代码

#### 实现完整性
4. 每条 spec 规则在某个实现文件中有 @implements
5. 无存根代码
6. 无硬编码 secret
7. 领域模型与 Harness 计划中的聚合定义一致

#### 测试通过
8. 所有测试 GREEN（后端 + 前端）

#### 追溯完整性
9. 每个 @implements 可追溯到 spec.md 中的规则
10. 每个实现文件有 @intent 标注

#### 前端完整性（如适用）
11. 前端页面覆盖了 Harness 计划中定义的所有交互
12. 前端组件实现了所有 state/actions/events

#### 代码品味
13. 函数 ≤ 20 行
14. 无 catch 空块
15. 无硬编码魔法数字/字符串

### 门禁脚本

快速检查：`bash skills/shadow-l5-impl/scripts/gate-check-l5.sh <slug>`
