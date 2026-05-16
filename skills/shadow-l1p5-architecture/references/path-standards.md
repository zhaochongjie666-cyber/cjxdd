# Path Standards — 路径规范

## L1.5 产出路径

```
.shadow/
└── L1.5-architecture/
    └── <biz-dir>/
        ├── architecture.md          # 架构总览（本 skill 产出）
        └── README.md                 # 架构说明（可选）
```

## 路径格式

- 目录默认复用 L1 业务目录名，通常为 `BXX-{slug}`
- 不要在 L1.5 重新生成新的 BXX 前缀
- slug 使用小写字母、数字、连字符
- 示例：`B01-user-service`, `B02-order-system`

## 与其他 L1.5 技能的协作

| 技能 | 产出路径 | 说明 |
|------|----------|------|
| shadow-l1p5-architecture | `L1.5-architecture/<biz-dir>/architecture.md` | 架构总览 |
| shadow-l1p5-architecture | `L1.5-architecture/<biz-dir>/file-list.md` | 文件清单（原 shadow-l1p5-filelist 已合入，不再单独派发） |
| shadow-l1p5-architecture | `L1.5-architecture/<biz-dir>/quality.md` | 质量规划（原 shadow-l1p5-quality 已合入，不再单独派发） |

## 迭代作用域说明

L1.5 架构文档属于**跨迭代共享**设计产物，路径不随迭代变化：

- `.shadow/L1.5-architecture/BXX-{slug}/architecture.md`
- `.shadow/L1.5-architecture/BXX-{slug}/docker-compose.yml`
- `.shadow/L1.5-architecture/aggregate-landscape.md`
- `.shadow/L1.5-architecture/event-contract.md`

**迭代作用域（每个迭代独立）**路径由 `{迭代作用域}` = `.shadow/iterations/{当前迭代}` 标识，包括 gate、pipeline、feature-status、L5-plan、L6-deploy、reviews。详见 `shadow-team.md §0.2.1`。

## 文件命名规范

- architecture.md: 架构总览文档
- file-list.md: L1 规则到文件的映射
- quality.md: 6 维质量规划
- README.md: 补充说明（可选）
