# Shadow 目录结构标准

## 标准目录布局

```
.shadow/
├── current-iteration                   # 当前迭代 ID 文件（如 iter-3）
├── INDEX.md                            # 业务索引（跨迭代累积）
├── TRACE.md                            # 追溯矩阵总览（跨迭代累积）
├── reverse-complete                    # 逆向工程完成标记（可选，一次性）
│
├── iterations/                         # 迭代隔离目录
│   └── {当前迭代}/
│       ├── gate/                       # Gate 通过标记（各层 gate-pass.sh 产出）
│       │   ├── l1.{slug}.passed
│       │   ├── l1p5.{slug}.passed
│       │   ├── l2.{slug}.passed
│       │   ├── l3.{slug}.passed
│       │   ├── l4.{slug}.passed
│       │   ├── l5.{slug}.passed
│       │   └── l6.{slug}.passed
│       ├── pipeline/
│       │   └── status.md               # 管道全局进度
│       ├── feature-status/             # L5 实现节点完成标记
│       │   └── {slug}/
│       │       └── BXX-NYY.done
│       ├── L5-plan/                    # L5 执行计划
│       │   └── {slug}/
│       │       └── plan-{batch}.md
│       ├── L6-deploy/                  # L6 部署验证
│       │   └── {slug}/
│       │       ├── deployment-report.md
│       │       └── uat-evidence/
│       └── reviews/                    # 审查报告
│           ├── semantic-gate/          # 各层语义门报告
│           │   ├── l1.{slug}.md
│           │   ├── l1p5.{slug}.md
│           │   ├── l2.{slug}.md
│           │   ├── l3.{slug}.md
│           │   ├── l4.{slug}.md
│           │   ├── l5.{slug}.md
│           │   └── l6.{slug}.md
│           ├── chain/                  # 全链路审计报告
│           │   └── {slug}/
│           └── ux/                     # UX 审查报告
│               └── {slug}/
│
├── L1-business/                        # L1 业务设计（跨迭代共享）
│   ├── intent.md                       # 项目意图定义
│   ├── business-landscape.md           # 业务全景
│   ├── project.flow.mermaid            # 项目级唯一流程总图
│   ├── BXX-{slug}/
│   │   ├── research.md                 # 调研文档
│   │   ├── spec.md                     # 业务规格
│   │   ├── wire.svg                    # UI 线框图（可选）
│   │   └── template-selection.yaml     # Wire 模板选择（可选）
│   └── ...
│
├── L1.5-architecture/                  # L1.5 架构规划（跨迭代共享）
│   ├── aggregate-landscape.md          # 聚合全景
│   ├── event-contract.md               # 事件契约
│   └── BXX-{slug}/
│       ├── architecture.md             # 架构总览
│       ├── docker-compose.yml          # 生产配置
│       ├── docker-compose.test.yml     # 测试配置
│       └── ...
│
├── L2-e2e/                             # L2 端到端验收（跨迭代共享）
│   └── BXX-{slug}/
│       ├── e2e.md                      # 验收场景
│       ├── coverage-matrix.md          # 覆盖矩阵
│       └── uat-script.md               # UAT 剧本
│
├── L5-plan/                            # L5 Plan（跨迭代共享）
│   └── {slug}/
│       └── harness-plan.md
│
├── .hashes/                            # 内容变更哈希缓存（可选）
│   ├── l1/
│   ├── l2/
│   ├── l3/
│   └── l4/
│
├── .team/                              # Worker 状态记录（可选）
│   └── worker_ufw_status.json
│
├── .ufw/                               # UFW 打磨记录（可选）
│   └── <layer>_<slug>_R{1,2,3,4,5}.chkpt
│
├── bizline-report.md                   # Reverse 业务线检测报告（可选）
└── r-scan.md                           # Reverse 扫描报告（可选）
```

## 标准约束

- **迭代作用域**路径：gate / pipeline / feature-status / L5-plan / L6-deploy / reviews
- **跨迭代共享**路径：L1-business / L1.5-architecture / L2-e2e / L5-plan / INDEX.md / TRACE.md
- 所有层产物必须采用目录式路径
- 禁止平铺文件名（如 `<slug>.spec.md`）
- 禁止旧目录名（如 `L1.5-arch` / `L2-acceptance` / `L6-deploy` / `L5-implementation`）
- L1 线框图主标准为 `wire.svg`
- 每次新迭代自动递增 ID（iter-1 → iter-2 → ...），由 `iter-helpers.sh` 管理

## INDEX.md 标准格式

```markdown
# L1 业务索引

> 自动生成于 YYYY-MM-DD HH:mm:ss

| 业务 Slug | 业务名称 | 主业务 | 状态 | 规则数 | 代码覆盖 | 测试覆盖 | 创建时间 | 最后更新 |
|-----------|---------|:------:|:----:|:------:|:--------:|:--------:|----------|----------|
| B01-user-auth | 用户认证 | ⭐ | ✅ passed | 12 | 12/12 | 10/12 | 2024-01-01 | 2024-01-15 |
| B02-order-mgmt | 订单管理 | | ✅ passed | 8 | 8/8 | 6/8 | 2024-01-02 | 2024-01-10 |
```

## TRACE.md 标准格式

由 `bash skills/shadow-trace-init/scripts/trace.sh matrix` 自动生成，包含：
- 规则 ID → 代码文件的实现映射
- 规则 ID → 测试文件的覆盖映射
- 覆盖率统计
