# L1 Flow 工作清单（Steps 2, 3, 5）

> 从 L1 worker 中提取的流程图相关步骤。

## Todolist 相关行

| # | 任务 | 说明 | 优先级 |
|---|------|------|--------|
| 2 | project.flow.mermaid | 基于接入点画出包含新能力的完整流程 | high |
| 3 | AI-Flow 门禁 | AI 评审 flow（饱满度/周密度/解耦度/接入点清晰度），**必须运行 Mermaid 渲染校验脚本（`mermaid-check/scripts/mmdc_check.sh`，或 L1 Flow 内置 mmdc-check）**，通过才能继续 | high |
| 5 | 完善 project.flow.mermaid | 根据实现调研结论调整细化 | medium |

## 业务流程图要求

- **项目级总图**：只维护 `.shadow/L1-business/project.flow.mermaid` 一张图，不再按业务线创建独立 flow
- **开始入口**：第一个节点明确标注触发来源
- **输出/交付物**：最后几个节点展示用户能拿到的东西
- **用户实际获取**：用 resultNode 颜色标注最终交付物

### 总图组织规则（强制执行）

**Shadow Flow 必须是一张项目级总图。** 复杂度通过泳道、聚合分组、节点命名和 spec 细化承接，不通过拆业务线 flow 解决。

**总图规则：**
- BXX subgraph 表示领域/泳道，不表示独立文件
- 所有 BXX-NYY 节点必须出现在 `.shadow/L1-business/project.flow.mermaid`
- 跨泳道同步调用必须标注 `HTTP` / `RPC` / `query`
- 跨泳道异步协作必须用虚线事件边，并命名为 `event: domain.action`
- 复杂节点的内部细节写入 `spec.md` 规则和异常路径，不新建业务线 flow 文件

**禁止：**
- 禁止创建 `B01-user/project.flow.mermaid`、`B02-payment/project.flow.mermaid`
- 禁止创建 `*.project.flow.mermaid` 作为业务线子图
- 禁止用子流程文件隐藏关键业务分支

**漂移预防：**
- 修改业务路径时直接更新总图对应 BXX-NYY 节点和边
- 新增业务路径时在总图新增节点，不另开业务线图
- 总图与 spec/wire/L2/L5 的 BXX-NYY 引用必须保持一致

## 生成后自动检查

生成 `.shadow/L1-business/project.flow.mermaid` 后，运行 Mermaid 渲染校验和 L1 Gate 检查：
- 第一行是有效 Mermaid 图表类型声明
- flowchart 指定方向（TD/TB/BT/RL/LR）
- subgraph 标题不使用节点形状标记 `[]`
- classDef 定义的样式在 class 语句中被使用
- resultNode 的 class 有对应 classDef 定义
