---
name: shadow-l1-spec
alias: Shadow·L1-Spec
methodology: |
  FDD-inspired — Feature-Driven Development: 
  ✅ 全局模型 (L1 Research + Flow) 
  ✅ 特性清单 (本层 Spec，RXX 规则编号) 
  ➕ 按特征迭代交付 (L5 Impl，BXX-NYY 节点粒度) 
  ℹ️ FDD 的 Plan-by-Feature 由 L1.5 Architecture 承接，Design-by-Feature 由 L5 Harness 计划承接
description: |
  Shadow L1 业务规格（FDD 特性思维）。产出 spec.md，帮你想清楚"要交付哪些特性"。
  每条规则 = 一个可交付特性，按聚合分组形成 Feature Set。
  规则编号（RXX）是后续 L1.5 API 端点清单的追溯源。
  触发：规格、spec、特性、feature、业务规则。
version: "4.2.0"
---

# Shadow·FDD-inspired — 特性驱动规格

## 角色

把流程图的每一个操作节点翻译成业务规则。每条规则 = 一个可交付的特性。

FDD 完整生命周期在 Shadow 链中的分布：
```
Step 1 Develop Overall Model:   research.md + project.flow.mermaid     ← L1 Research + Flow
Step 2 Build Feature List:      spec.md (RXX 规则)            ← L1 Spec（本层）
Step 3 Plan by Feature:         architecture.md               ← L1.5 Architecture
Step 4 Design by Feature:       harness-plan.md 精密执行计划    ← L5 Plan
Step 5 Build by Feature:        BXX-NYY 逐节点迭代交付        ← L5 Impl

规则编号（RXX）是 L1.5 API 端点清单的核心追溯键——每个 API 端点必须标注覆盖的规则。
流程节点编号（BXX-NYY）是 L5 按特征交付的粒度单位。
```

## 怎么做

### 1. 读 project.flow.mermaid + research.md

每个 flow 节点，问：
- 这个操作背后有什么业务规则？
- 谁允许执行？（角色/权限）
- 什么条件下能执行？（前置条件）
- 执行后发生了什么？（状态变化、事件发布）
- 不满足条件怎么办？（异常路径、错误提示）
- **这个规则需要什么 API 操作？**（GET/POST/PUT/DELETE，预留给 L1.5 思考）

### 2. 按聚合分组

把同一聚合的规则写在一起。聚合名来自 research.md。

示例：
```
Feature Set: 标注 (Aggregate: Annotation)

annotation-R01 | 打开标注任务
  - 标注员可打开分配给自己的任务
  - 前置：任务已分配给当前用户
  - API 预映射: GET /api/tasks/:taskId (Annotator 角色)
  - 异常：任务不存在 → 404；任务未分配 → 403

annotation-R02 | 创建标注
  - 标注员可对任务创建标注（2D 框/3D 框/语义标签）
  - 前置：任务已打开
  - API 预映射: POST /api/annotations (Annotator 角色)
  - 异常：标签无效 → 400；坐标超范围 → 400

annotation-R03 | 提交质检
  - 标注员可提交标注进入质检流程
  - 前置：标注非空，标注状态为 IN_PROGRESS
  - API 预映射: POST /api/annotations/:id/submit (Annotator 角色)
  - 副作用：发布 AnnotationSubmitted 事件
  - 异常：标注为空 → 400
```

### 3. 标记领域模型关联

每个规则如果涉及：
- **聚合根** → 标出（如 Order）
- **值对象** → 标出（如 Money、Address）
- **领域事件** → 标出（如 OrderPlaced）
- **实体** → 标出（如 OrderItem）
- **流程节点** → 标出（如 B02-N07）
- **API 预映射** → 标出（如 POST /api/annotations）

不需要单独建表，在规则中标注即可。

### 4. 规则 → API 操作预映射

在写规则时，问自己：
- **这个规则是查询还是操作？**（查询用 GET，操作用 POST/PUT/DELETE）
- **输入参数是什么？**（URL 参数 vs Body 参数）
- **返回结果是什么？**（资源实体 vs 操作结果）
- **谁有权限？**（角色标注）

**示例映射**：
```
annotation-R01 打开任务 → GET /api/tasks/:taskId (返回 TaskRes)
annotation-R02 创建标注 → POST /api/annotations (请求 CreateAnnotationReq, 返回 AnnotationRes)
annotation-R06 修改返工 → PUT /api/annotations/:id (请求 UpdateAnnotationReq, 返回 AnnotationRes)
annotation-R03 提交质检 → POST /api/annotations/:id/submit (返回 { success, next_task_id })
annotation-R04 质检通过 → POST /api/reviews/:id/approve (返回 ReviewRes)
```

这些映射不需要写成完整 API 定义，但要有意识，为 L1.5 API 端点清单做准备。

### 5. 给下游交代

快速过一遍：
- L1.5 能从这拆出模块边界吗？
- L1.5 能从这定义 API 端点清单吗？**（每条规则是否有 API 入口？）**
- L2 能从这写出验收场景吗？
- L3/L5 能从这看出输入、动作、状态、副作用吗？

### 品味引导：精确与克制的规则语言

**规则是契约，不是描述。** 好的规则让下游（L1.5/L2/L5）读完后能直接开工，不需要再找你确认：

```
无品味（模糊的描述）:
  annotation-R02 | 用户可以标注数据
  （谁？怎么标注？标什么？约束？→ 全部靠猜）

有品味（清晰的契约）:
  annotation-R02 | 标注员可在画面上创建 2D 框并关联标签模板中的标签
  （角色明确、动作明确、产物明确、约束明确）
```

判断标准：删除任意一个定语，规则是否变模糊？→ 定语太少，补充。

**异常路径体现对用户的尊重。** 写异常不是应付检查的——每一条异常都对应一个用户在真实场景中遇到的困惑：

```
无品味（技术导向）:
  异常：参数错误 → 400

有品味（用户导向）:
  异常：标注框坐标 x=1200 超出画面宽度 1000
       → 400 BBOX_OUT_OF_RANGE
  异常：标签 ID 不在当前项目的标签模板中
       → 400 INVALID_LABEL
```

后者让前后端对齐、让 L2 写出精确测试、让用户看到能理解错误原因。一条异常写好了，三层受益。

**分组的秩序感。** 规则清单读起来应该像一本书的目录——同一聚合的主题在一起，主题间有清晰的分割线：

```
有秩序:
  Feature Set: 标注 (Aggregate: Annotation)
    annotation-R01 打开任务
    annotation-R02 创建标注
    annotation-R03 提交质检
    annotation-R06 修改返工

  Feature Set: 质检 (Aggregate: Review)
    annotation-R04 质检通过
    annotation-R05 质检驳回

无秩序:
  规则列表：
    annotation-R02 创建标注
    annotation-R04 质检通过
    annotation-R01 打开任务
    annotation-R05 质检驳回
    annotation-R03 提交质检
    annotation-R06 修改返工
```

判断标准：如果读者要来回滚动才能理解上下文 → 重新排列规则顺序。

**克制：不多写一条规则。** 多余的规则和遗漏的规则一样有害。判断标准：这条规则如果删掉，L2 会漏测什么？L5 会少实现什么？回答不了 → 删。

## 规则的 Gherkin 场景描述（可选增强）

规则表格适合全景扫描，但**关键规则**（P0、多条件分支、复杂异常）建议补充 Gherkin 场景描述，让 L2 E2E 可以直接消费：

```gherkin
  @P0 @covers-annotation-R02
  Feature: 标注员创建标注

  Scenario: 标注员在画面上创建有效 2D 框标注
    Given 任务已打开，状态为 IN_PROGRESS
      And 当前用户角色为 Annotator
    When 标注员在画面上拖拽创建矩形框并关联标签 "car"
    Then 创建标注记录，状态 EMPTY → IN_PROGRESS
      And 发布 AnnotationCreated 事件

  Scenario: 标签不在项目模板中
    Given 任务已打开
    When 标注员尝试关联标签 ID "unknown-uuid"
    Then 拒绝创建，错误码 INVALID_LABEL

  Scenario: 标注框坐标超出画面范围
    Given 任务已打开
    When 标注员创建框坐标 x=1200 超出画面宽度 1000
    Then 拒绝创建，错误码 BBOX_OUT_OF_RANGE
```

**纪律**：
- 一个 Scenario 一个行为分支（正常路径 / 一个异常）
- Given 只写前置状态，不写操作
- When 只写一个动作
- Then 断言具体值（状态变化 + 事件 + 错误码），禁止"功能正常"
- @covers 标签标注规则 ID

Gherkin 完整语法参考见 `skills/shadow-l2-e2e/references/gherkin-guide.md`。

## 产出

`.shadow/L1-business/BXX-{slug}/spec.md`

建议包含：
- 业务目标（一句话）
- 角色列表
- 规则清单（按聚合分组）
- 规则 Gherkin 场景（P0 规则建议补充，直接传导给 L2）
- 领域模型标注（嵌入规则中）
- **API 预映射（嵌入规则中）**
- 给下游的说明

## 约束

- 每个规则编号格式：`{slug}-R01`、`{slug}-R02`、...（slug 与业务线 BXX-{slug} 一致，R 编号连续无跳号）
- 术语必须来自 research.md 的统一语言
- 不要写"功能正常"这种模糊断言。异常时发生什么要写清楚
- **每条规则标注对应的流程节点（如 B02-N07）**
- **每条规则预映射 API 操作（至少一个端点入口）**
- **用户交互类规则必须标注 API 预映射**

## 品味约束

引用 `references/taste-criteria.md`。交付前通过致命三检：

- [ ] 减法：删 30% 内容后核心传导不断裂
- [ ] 人话：新人 5 分钟理解核心
- [ ] 一致：术语跨层一致，无同义词混用

Spec 特化：异常写用户能懂的话，不写裸 HTTP 状态码。规则中"用户"替换为具体角色名。

## 简单项目示例：自动驾驶数据平台

### Feature Set: 采集打点 (Aggregate: Collection)

| 规则 ID | 特性描述 | 触发条件 | 前置条件 | 预期结果 | 优先级 | 节点坐标 | 用户可见 | 需 Wire 承接 | UI 载体/方位 |
|---------|---------|---------|---------|---------|--------|---------|---------|-------------|-------------|
| collection-R01 | 创建采集任务 | Collector 点击新建 | 路线/区域已填写 | 创建任务，状态 DRAFT | P0 | B01-N01 | 是 | 是 | 采集任务表单 |
| collection-R02 | 开始采集 | Collector 点击开始 | 任务状态 DRAFT | 状态变为 COLLECTING，发布 CollectionStarted | P0 | B01-N02 | 是 | 是 | 任务详情页 |
| collection-R03 | 记录打点 | 采集过程中点击打点 | 任务状态 COLLECTING | 创建打点记录（GPS+场景类型+时间戳） | P0 | B01-N03 | 是 | 是 | 采集地图页 |
| collection-R04 | 结束采集 | Collector 点击结束 | 任务状态 COLLECTING，至少 1 个打点 | 状态变为 FINISHED，发布 CollectionFinished | P0 | B01-N04 | 是 | 是 | 任务详情页 |
| collection-R05 | 上传数据 | 系统自动触发 | 任务 FINISHED | 数据上传对象存储，发布 DataAvailable | P0 | B01-N05 | 是 | 是 | 任务详情页进度条 |

### Feature Set: 标注 (Aggregate: Annotation)

| 规则 ID | 特性描述 | 触发条件 | 前置条件 | 预期结果 | 优先级 | 节点坐标 | 用户可见 | 需 Wire 承接 | UI 载体/方位 |
|---------|---------|---------|---------|---------|--------|---------|---------|-------------|-------------|
| annotation-R01 | 打开标注任务 | Annotator 点击任务 | 任务已分配给当前用户 | 加载任务帧数据 | P0 | B02-N06 | 是 | 是 | 任务列表→任务详情 |
| annotation-R02 | 创建标注 | Annotator 完成标注操作 | 任务已打开 | 创建标注记录，发布 AnnotationCreated | P0 | B02-N07 | 是 | 是 | 标注编辑器 |
| annotation-R03 | 提交质检 | Annotator 点击提交 | 标注非空，状态 IN_PROGRESS | 状态变为 SUBMITTED，发布 AnnotationSubmitted | P0 | B02-N08 | 是 | 是 | 标注编辑器提交按钮 |
| annotation-R04 | 质检通过 | Reviewer 点击通过 | 标注状态 SUBMITTED | 状态变为 APPROVED，发布 ReviewPassed | P0 | B02-N09 | 是 | 是 | 质检页面 |
| annotation-R05 | 质检驳回 | Reviewer 点击驳回+填原因 | 标注状态 SUBMITTED | 状态变为 REJECTED，发布 ReviewRejected | P0 | B02-N10 | 是 | 是 | 质检页面驳回弹窗 |
| annotation-R06 | 修改返工 | Annotator 修改后重新提交 | 标注状态 REJECTED | 更新标注，回到 SUBMITTED | P0 | B02-N11 | 是 | 是 | 标注编辑器 |

### Feature Set: 仿真播放 (Aggregate: Simulation)

| 规则 ID | 特性描述 | 触发条件 | 前置条件 | 预期结果 | 优先级 | 节点坐标 | 用户可见 | 需 Wire 承接 | UI 载体/方位 |
|---------|---------|---------|---------|---------|--------|---------|---------|-------------|-------------|
| simulation-R01 | 选择场景 | Operator 点击场景 | 场景已有采集数据 | 加载场景元数据 | P0 | B03-N12 | 是 | 是 | 场景列表页 |
| simulation-R02 | 播放回放 | Operator 点击播放 | 场景已加载 | 同步播放视频+点云+标注叠加 | P0 | B03-N13 | 是 | 是 | 仿真播放器 |
| simulation-R03 | 标记问题 | Operator 点击标记 | 回放进行中 | 创建问题记录（帧号+时间戳+描述） | P1 | B03-N14 | 是 | 是 | 播放器内标记按钮 |
| simulation-R04 | 导出报告 | Operator 点击导出 | 至少 1 个场景已播放 | 生成仿真报告 PDF/JSON | P1 | B03-N15 | 是 | 是 | 仿真报告页 |

**异常处理**：

| 场景 | 规则 | 处理方式 | ERROR_CODE | 用户提示 |
|------|------|---------|------------|---------|
| 路线未填写 | collection-R01 | 拒绝创建 | INVALID_ROUTE | "请填写采集路线" |
| 任务无打点就结束 | collection-R04 | 拒绝结束 | NO_WAYPOINT | "至少记录 1 个打点" |
| 标注为空提交 | annotation-R03 | 拒绝提交 | EMPTY_ANNOTATION | "标注不能为空" |
| 驳回无原因 | annotation-R05 | 拒绝驳回 | REJECT_REASON_REQUIRED | "请填写驳回原因" |
| 场景无数据 | simulation-R02 | 拒绝播放 | SCENE_NO_DATA | "该场景无采集数据" |

**API 预映射**：

| 规则 | API 操作 | 请求体 | 响应体 |
|------|---------|--------|--------|
| collection-R01 | POST /api/collections | {route, area, scheduled_at} | {id, status: DRAFT, ...} |
| collection-R02 | PATCH /api/collections/:id/start | — | {status: COLLECTING} |
| collection-R03 | POST /api/collections/:id/waypoints | {lat, lng, scene_type, timestamp} | {waypoint_id} |
| collection-R04 | PATCH /api/collections/:id/finish | — | {status: FINISHED} |
| collection-R05 | POST /api/collections/:id/upload | multipart/form-data | {upload_id, progress} |
| annotation-R01 | GET /api/tasks/:taskId | — | {task with frames} |
| annotation-R02 | POST /api/annotations | {task_id, type, values[]} | {id, status, ...} |
| annotation-R03 | POST /api/annotations/:id/submit | — | {status: SUBMITTED} |
| annotation-R04 | POST /api/reviews/:id/approve | — | {status: APPROVED} |
| annotation-R05 | POST /api/reviews/:id/reject | {reason} | {status: REJECTED} |
| annotation-R06 | PUT /api/annotations/:id | {values[]} | {updated} |
| simulation-R01 | GET /api/simulations/scenes | — | {scenes[]} |
| simulation-R02 | POST /api/simulations/:id/play | — | {stream_url} |
| simulation-R03 | POST /api/simulations/:id/issues | {frame_no, timestamp, description} | {issue_id} |
| simulation-R04 | POST /api/simulations/:id/export | {format} | {report_url} |

## 层内自检

完成后加载 `shadow-l1-flow` skill 执行 L1 门禁自检（只检查本 agent 产出物相关的检查项）。全部 L1 agent 完成后执行完整 L1 gate 检查。

传导映射（spec → L1.5/L5）见 `references/spec-conduction.md`。
