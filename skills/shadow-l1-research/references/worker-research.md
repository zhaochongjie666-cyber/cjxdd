# L1 Worker — Research 相关步骤摘录

> 摘自 `worker.md`，仅保留 research（流程维度 Step 1 + 实现维度 Step 4）相关内容。

## L1 工作清单（research 相关步骤）

| # | 任务 | 说明 | 优先级 |
|---|------|------|--------|
| 1 | research 流程维度 | 扫一眼现有 flow，确定新能力在哪接入、影响谁 | high |
| 4 | research 实现维度 | 方案选型、竞品分析、技术决策依据 | high |

## 生成顺序说明

> 迭代关系：不 research 不知道在哪接入 flow → 不画 flow 不知道 research 要解决什么问题。流程维度先行确定接入点（第1步），flow 画出结构（第2步），AI 门禁评审质量 + **mermaid-cli 渲染验证**（第3步），实现维度跟进给方案（第4步），调研结论完善 flow（第5步），wire 承接页面（第6步），spec 综合总结（第7步），门禁检查（第8步）。

## 多业务线接入判断

```text
[收到新业务需求]
  ↓
[扫描 `.shadow/L1-business/project.flow.mermaid` 总图]
  ↓
{是否存在匹配的业务线？}
  ├─ 是 → 在总图对应 biz-{id} subgraph 中扩展节点和边
  │        → 如有新跨线连接 → 在总图增加带标签的跨泳道边
  └─ 否 → 在总图创建新的 biz-{new-id} subgraph
           → 添加入口、出口、异常路径和跨泳道连接
           → 更新 mermaid 配色表（如需要新配色）
```

**业务线分类决策树：**

```
用户/调用方能否直接感知此功能？
  ├─ 是 → 核心业务（biz-order, biz-user）
  └─ 否 → 是否为核心业务不可或缺？
          ├─ 是 → 支撑业务（biz-notification, biz-audit）
          └─ 否 → 基础设施（不分配 biz-id，归入 infra 区）
```

**跨线连接修改影响面分析：**

```
1. 确定变更的业务线 biz-{id}
2. 读取 project.flow.mermaid 主流程，查找所有连接到 biz-{id} 的边
3. 列出受影响的业务线（上游调用方 + 下游消费方）
4. 在 research.md 变更记录中声明影响面
5. 按影响面依次更新各业务线的 project.flow.mermaid
6. 更新跨业务线依赖表（spec.md 中）
```

> 详见 [`multi-bizline.md`](./multi-bizline.md)

## 变更模式

### 第一步：变更调研（必须）

在 `research.md` 末尾追加 `## 变更记录` 章节：
- 变更原因（需求变更 / bug 修复 / 技术升级 / 用户反馈）
- 影响面分析（影响哪些 L1 文件、影响哪些下游 L2/L3/L4/L5）
- 决策依据（为什么这样改，备选方案对比）

### 关键原则

- research.md 不是一次性的，随变更持续演进
- 每次变更都追加一条记录，保留完整决策链
- 上游文件必须先于下游文件更新
