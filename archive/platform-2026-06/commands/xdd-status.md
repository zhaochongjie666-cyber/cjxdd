---
description: 打印 .xdd 项目的当前 Phase 状态汇总 + BXX 业务线维度
argument-hint: (无参数)
---

# /xdd-status — 打印 Phase 状态汇总

读取 `.xdd/iterations/{current-iteration}/pipeline/status.md`, 输出:
1. 当前 Phase 阶段
2. 各 Phase 行状态 (✅/⏳/🔄/❌)
3. BXX 业务线维度汇总 (多业务线项目)
4. 跨 BXX 一致性 checklist
5. 当前 scale.md strict-mode 状态

## 用法

```
/xdd-status
```

无参数, 纯读取 .xdd/ 当前状态输出汇总.

## 输出格式

```
[xdd] === Pipeline Status ===
[xdd] iter: iter-1
[xdd] scale: M (strict_mode: true)
[xdd]
[xdd] | Phase | 状态 | 备注 |
[xdd] | 0 INIT | ✅ | .xdd/ + scale.md + status.md |
[xdd] | 1 RESEARCH | ⏳ | |
[xdd] | 2 DESIGN | ⏳ | |
[xdd] | 2.5 BDD | ⏳ | |
[xdd] | 2.7 SCAFFOLD | ⏳ | |
[xdd] | 3 REVIEW | ⏳ | |
[xdd] | 4 PLAN | ⏳ | |
[xdd] | 5 EXECUTE | ⏳ | |
[xdd] | 6 VERIFY | ⏳ | |
[xdd]
[xdd] === Current Stage ===
[xdd] 1 RESEARCH (skill: xdd-l0)
[xdd] expected output: .xdd/iterations/iter-1/research/*.md
[xdd] next stage skill: xdd-bdd
[xdd]
[xdd] === 5 步节奏 (Walker discipline) ===
[xdd] ① 装 xdd-l0 工具
[xdd] ② 写 checklist 到 status.md
[xdd] ③ 按 SKILL.md 流程干
[xdd] ④ 自检 + 标 ✅ DONE
[xdd] ⑤ 加载下一 stage (xdd-bdd)
```

## 多业务线时

```
[xdd] === BXX 业务线维度 ===
[xdd] B01 用户管理 | done=1 in_progress=1 pending=0 failed=0
[xdd] B02 订单管理 | done=0 in_progress=0 pending=3 failed=0
```

## 行为

- 仅读取 `.xdd/`, 不修改任何文件
- 退出码 0
- 找不到 `.xdd/` 时: 输出 "无 .xdd 项目" 提示并退出 1
