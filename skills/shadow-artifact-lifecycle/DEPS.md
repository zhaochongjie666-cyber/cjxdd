# DEPS — shadow-artifact-lifecycle

## 运行时依赖

| 依赖 | 必需 | 用途 |
|------|------|------|
| `bash` ≥ 4 | ✓ | 跑 `scripts/gate-check-lifecycle.sh` |
| `jq` ≥ 1.6 | ✓ | 读 `shadow-schema.json:lifecycle_artifacts[]` |
| `coreutils` (`chmod` / `find` / `stat`) | ✓ | R3/R10 写阻断 + 自动归档 |

## 软依赖(可选)

| 依赖 | 用途 |
|------|------|
| `shadow-init` | 创建 `.shadow/LIFECYCLE.md` 索引页 |
| `shadow-trace-init` | 启动时读本 skill 分类的角色做反向追溯 |
| `shadow-reviewer` | chain 审计时引用 5 角色分布 |

## 集成点

- `hooks/lib.sh`:`lifecycle_role_of` / `lifecycle_paths_by_role` / `count_lifecycle_role_files`(3 个查询函数,Phase 1 已加)
- `hooks/stop-gate.sh`:5 条硬门禁(R1 / R3 / R5 / R6 / R10,Phase 2 升级)
- `hooks/session-start.sh`:"角色分布"启动打印(Phase 1 已加,Phase 2 升级硬阈值)
- `hooks/post-write-stub-scan.sh`:R3 证据写阻断 + R6 路径 locality(Phase 2 加)

## 调用方

- `shadow-walker` 装本 skill 查"我现在改的这份产物是 design_baseline 还是 process_output"
- `shadow-reviewer` chain 审计用 5 角色分布作评估维度
- `shadow-trace-init` 反向追溯按角色加权

## 不依赖

- 不依赖任何项目代码或具体技术栈
- 不引入新的二进制工具(纯 bash + jq)
- 不写新 schema 字段(只读 `lifecycle_artifacts[]` 已存在的 5 角色 + 58 工件)
