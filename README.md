# Shadow — 带工具箱的工匠型开发体系

基于 OpenCode Agent + Skill 的全链路软件开发体系。一个 Agent（Shadow Walker）带一套工具箱（12 个核心 Skill），从调研到部署一个人把项目做到能交付。

## 架构

```text
Agent: shadow-walker（工匠，不是调度员）
  ↓ 按需加载 skill
Skills: 12 个核心工具 + 8 个小工具
  ↓ 产出到 .shadow/ 目录
产出: intent.md → flow → spec → wire → architecture → harness-plan → code → deploy
```

### 流水线

```text
L0 发散调研      ── shadow-l0-research
L1 业务层        ── shadow-l1-research → flow → spec → wire（串行）
规模判定          ── .shadow/scale.md（S/M/L）
L1.5 架构        ── shadow-l1p5-architecture
搭脚手架          ── shadow-scaffold
L2 验收场景      ── shadow-l2-e2e
L5 执行计划      ── shadow-l5-plan
L5 代码实现      ── shadow-l5-impl（按 Batch 串行）
全链路审查        ── shadow-reviewer（必经）
L6 部署验证      ── shadow-l6-deploy
```

## 目录结构

```text
agents/
  shadow-walker.md          # 工匠型 Agent（345 行）
  shadow-worker.md          # 旧 Agent（保留参考）

skills/
  shadow-l0-research/       # L0 发散笔记本（112 行）
  shadow-l1-research/       # L1 DDD+EDD+IDDD 业务调研（468 行）
  shadow-l1-flow/           # L1 MDD 流程总图（367 行）
  shadow-l1-spec/           # L1 FDD 业务规格（271 行）
  shadow-l1-wire/           # L1 SVG 线框图（486 行）
  shadow-l1p5-architecture/ # L1.5 ADD 架构设计（357 行）
  shadow-scaffold/          # 项目脚手架（255 行）
  shadow-l2-e2e/            # L2 BDD 验收场景（250 行）
  shadow-l5-plan/           # L5 Harness 精密执行计划（393 行）
  shadow-l5-impl/           # L5 代码实现（159 行）
  shadow-l6-deploy/         # L6 部署验证（247 行）
  shadow-reviewer/          # 全链路审查（222 行）
  skill-creator/            # Skill 创建标准（494 行）
  shadow-reverse/           # 逆向已有系统
  shadow-taste/             # 品味检查
  shadow-trace-init/        # 追溯初始化
  mermaid-check/            # Mermaid 渲染验证
  docker-helper/            # Docker 问题排查
  test-in-tmux/             # 测试运行

  # 每个 skill 目录结构：
  skill-name/
    SKILL.md                # 快速入门（< 500 行）
    references/             # 详细指南（按需读取）
    templates/              # 模板文件（部分 skill 有）
    scripts/                # Gate 检查脚本（部分 skill 有）
```

## 设计原则

### 渐进式披露

每个 Skill 的 SKILL.md 是快速入门（< 500 行），详细内容在 `references/` 里按需读取。Walker 不会一次读完所有材料，而是跟着 SKILL.md 的流程走，遇到需要深入了解的环节才读对应的 reference。

### 传导链追溯

```text
intent.md（为什么做）
  → research.md（业务领域）
    → project.flow.mermaid（BXX-NYY 节点编号）
      → spec.md（RXX 规则编号）
        → architecture.md（API 端点清单）
          → harness-plan.md（逐方法实现指令 + 测试断言）
            → 代码（@implements 标注节点和规则编号）
```

每条规则、每个 API 端点、每行代码都能追溯到业务意图。

### 全局约束（L5 Harness）

多租户隔离、认证授权、统一错误格式、事件发布、分页、事务边界等横切关注点在 Harness 计划中作为"全局约束"段定义，所有文件统一遵守。

## 快速开始

1. 在 OpenCode 中配置 `shadow-walker` agent
2. 告诉 walker 你要做什么：*"给我做一个 XX 系统"*
3. Walker 自动走完 L0→L6 全流程
4. 交付物在 `.shadow/` 目录 + 项目代码中
