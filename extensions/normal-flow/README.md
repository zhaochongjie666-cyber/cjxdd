# Normal Flow (NF)

xdd 的精简版：5 阶段（explore -> spec -> plan -> implement -> verify），砍掉 AIGate / Hooks / Group Gates / Renderers，保留 reconcile 范式 + Controller 状态机。verify 阶段 17 道硬 gate 保证「产品连用都能用」，约束效果对齐 xdd。

设计文档：[`Docs/normal-flow.md`](../../Docs/normal-flow.md)。

## 用法

```
/normal-flow <任务描述>       # 启动一个新 run
/normal-flow-resume           # 从暂停状态或 checkpoint 恢复
/normal-flow-stop             # 中断当前 run（可再 resume）
```

## 文件布局

```
extensions/normal-flow/
├── stages.ts                       # 5 阶段定义（skill: nf-*/gate/desiredState）
├── evidence/verify-gate.ts         # 17 道硬 gate
├── scripts/nf-wander.sh            # 一键起服务 + 抓证据骨架
└── tools/nf-wander.ts              # 漫游记录工具

skills/nf-{brainstorm,spec,plan,execute,verify}/SKILL.md   # NF 专属 skill（与 xdd-* 隔离）
```

## 与 xdd 的关系

- **设计层共享**：`.xdd/design/`（intent.md / design.md / spec/）格式两种 flow 一致，可互相复用。
- **运行时分离**：`.xdd/runs/normal_run/` vs `.xdd/runs/xdd_run/` 互不干扰；evidence gate 拒绝跨 run 借证据。
- **skill 隔离**：`loadNfSkills()` 只加载 `nf-*`，`loadXddSkills()` 只加载 `xdd-*`。
- **约束等价**：NF 用 17 道硬 gate（filesystem check）替代 xdd 的 AIGate（LLM 审查）+ Blind Journey（Actor/Judge 二阶段）。

## 验证

```bash
cd extensions && bun test normal-flow/
```
