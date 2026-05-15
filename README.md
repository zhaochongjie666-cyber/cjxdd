# OpenCode Wireflow - 任务流程编排系统

基于 OpenCode 的 Skill，使用 Python 脚本和 JSON 文件实现任务流程编排。

## 项目结构

```
.
├── skills/
│   └── wireflow/
│       ├── SKILL.md          # 技能文档 - 使用指南
│       ├── EXAMPLES.md       # 使用示例
│       └── scripts/
│           ├── __init__.py   # Python 包初始化
│           └── wireflow.py   # 核心 Python 脚本
├── agents/
│   └── wireflow-primary.md   # Wireflow 主代理配置
└── README.md                 # 项目说明
```

## 功能特性

- **可视化流程**: 使用 Mermaid 图表和 ASCII 视图展示流程
- **状态管理**: 支持 pending/active/verifying/completed/failed/skipped 六种状态
- **依赖关系**: 支持顺序执行、并行执行、条件分支、回退边
- **父子节点**: 支持层级结构的任务组织
- **进度追踪**: 实时显示完成百分比和进度条
- **历史记录**: 完整的操作日志追踪
- **动态修改**: 支持运行时添加节点和边
- **Python 驱动**: 使用 Python 3 实现核心逻辑
- **JSON 存储**: 使用 JSON 文件持久化流程状态

## 快速开始

### 1. 创建流程

```bash
python skills/wireflow/scripts/wireflow.py create \
  --id "my-flow" \
  --name "我的流程" \
  --nodes '[
    {"id": "step1", "label": "第一步", "description": "分析需求"},
    {"id": "step2", "label": "第二步", "description": "实现功能"}
  ]' \
  --edges '[{"from": "step1", "to": "step2"}]'
```

### 2. 执行流程

完成每个节点后:
```bash
# 标记完成并进入验证
python skills/wireflow/scripts/wireflow.py advance \
  --pipeline-id "my-flow" \
  --note "已完成第一步"

# 验证通过
python skills/wireflow/scripts/wireflow.py seal \
  --pipeline-id "my-flow" \
  --result passed \
  --note "质量合格"
```

### 3. 查看状态

```bash
python skills/wireflow/scripts/wireflow.py status --pipeline-id "my-flow"
python skills/wireflow/scripts/wireflow.py render --pipeline-id "my-flow" --format both
```

## 命令列表

| 命令 | 功能 |
|------|------|
| `create` | 创建新流程 |
| `advance` | 推进到验证阶段 |
| `seal` | 验证节点结果 |
| `fail` | 标记节点失败 |
| `rollback` | 回退到上一个节点 |
| `status` | 查看流程状态 |
| `render` | 渲染流程图 |
| `list` | 列出所有流程 |
| `reset` | 重置流程 |
| `add-node` | 动态添加节点 |
| `add-edge` | 动态添加边 |

## 完整示例

### 软件开发流程

```bash
# 创建流程
python skills/wireflow/scripts/wireflow.py create \
  --id "feature-xyz" \
  --name "Feature XYZ 开发" \
  --nodes '[
    {"id": "analyze", "label": "需求分析", "artifact": "requirements.md"},
    {"id": "design", "label": "设计", "artifact": "design.md"},
    {"id": "implement", "label": "实现", "artifact": "code"},
    {"id": "test", "label": "测试", "artifact": "test results"}
  ]' \
  --edges '[
    {"from": "test", "to": "implement", "label": "测试失败", "is_fallback": true}
  ]'

# 执行流程
python skills/wireflow/scripts/wireflow.py advance --pipeline-id feature-xyz --note "分析完成"
python skills/wireflow/scripts/wireflow.py seal --pipeline-id feature-xyz --result passed --note "质量合格"

# 查看状态
python skills/wireflow/scripts/wireflow.py status --pipeline-id feature-xyz
```

## Python API 使用

```python
from skills.wireflow.scripts.wireflow import WireflowEngine

# 创建引擎
engine = WireflowEngine(".opencode/wireflow")

# 创建流程
pipeline = engine.create_pipeline(
    "my-flow",
    "我的流程",
    [
        {"id": "step1", "label": "第一步"},
        {"id": "step2", "label": "第二步"},
    ],
    [{"from": "step1", "to": "step2"}]
)

# 推进节点
result = engine.advance_node(pipeline, "完成第一步")

# 验证通过
result = engine.seal_node(pipeline, "passed", "质量合格")

# 渲染视图
print(engine.render_ascii(pipeline))
print(engine.render_mermaid(pipeline))
```

## 数据存储

所有流程状态存储在 `.opencode/wireflow/` 目录下:
- `{pipeline_id}.json` - 流程数据文件

JSON 格式:
```json
{
  "id": "my-flow",
  "name": "我的流程",
  "current_node_id": "step1",
  "nodes": [...],
  "edges": [...],
  "history": [...]
}
```

## 文档

- [技能文档](./skills/wireflow/SKILL.md) - 完整使用指南
- [示例文档](./skills/wireflow/EXAMPLES.md) - 详细示例

## 技术实现

基于 Python 3 开发，主要特性:

- **dataclasses**: 数据模型定义
- **argparse**: 命令行接口
- **json**: 数据持久化
- **pathlib**: 文件操作
- **typing**: 类型提示

## 灵感来源

本工具参考了 pi-coding-agent 的 piflow.ts 实现，使用 Python 和 JSON 重新实现。

## License

MIT
