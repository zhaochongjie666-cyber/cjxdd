# xdd-add — 已归档 (2026-06-09)

## 状态

**已合并入 `skills/xdd-arch/SKILL.md` (v7.0.0)**, 不再独立存在.

## 合并背景

`xdd-add` (Architecture Description) 与 `xdd-arch` (ADD+SDD+PDD) 内容字段重叠 ~60%:

| 字段 | add (旧) | arch (新) |
|------|---------|----------|
| 状态机 | ✓ | ✓ |
| 启动序列 | ✓ | (主流程一节) |
| 失败模型 | (异常边界) | ✓ |
| 并发模型 | ✓ | ✓ |
| 排障锚点 | ✓ | (可观测性) |
| 总体架构 | (隐含) | ✓ |
| 技术栈 | ✗ | ✓ |
| API 端点清单 | ✗ | ✓ |

历史成因: `xdd-add` 是早期 skill, `xdd-arch v6.0.0` 是后加的 ADD+SDD+PDD 强化版.

## 合并方案

`xdd-arch` v7.0.0 增加 § 12 "运维视图 (ODD — Operations-Driven Design)" 段, 吃掉 add 的 6 个原则 (启动序列 / 关闭序列 / 状态机 / 失败模型 / 并发与一致性 / 排障锚点), 跟 ADD/SDD/PDD 并列为第 4 大支柱.

## 工件路径迁移

| 旧 | 新 |
|----|---|
| `.xdd/baseline/add/{slug}/add.md` | `.xdd/baseline/arch/{slug}/architecture.md` § 12 |
| skill `xdd-add` | 装载 skill `xdd-arch` (v7.0.0+) |

## 兼容性

走老路径 (`.xdd/baseline/add/{slug}/add.md`) 的 demo 不影响, 但新项目按 v7.0.0 走 arch § 12.

## 文件清单 (本目录)

- `SKILL.md` — 原 `skills/xdd-add/SKILL.md` (160 行, ADD 模板)
