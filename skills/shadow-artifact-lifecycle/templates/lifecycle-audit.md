# Shadow 工件生命周期审计报告 — {ts}

> 跑法: `bash skills/shadow-artifact-lifecycle/scripts/gate-check-lifecycle.sh > audit-{ts}.md 2>&1`
> 输出: 本文件 + gate-check-lifecycle.sh 的 stdout/stderr

## 项目信息

| 字段 | 值 |
|------|-----|
| 项目根 | {project_root} |
| 跑测时间 | {iso_date} |
| schema 版本 | {shadow_version} |
| 迭代 | {current_iter} |

## 1. 5 角色分布 (schema 登记)

| 角色 | 工件数 | 占比 |
|------|--------|------|
| `design_baseline` | {n_db} | {%} |
| `process_output` | {n_po} | {%} |
| `evidence_archive` | {n_ea} | {%} |
| `control_marker` | {n_cm} | {%} |
| `template_instance` | {n_ti} | {%} |
| **总计** | **{n_total}** | **100%** |

## 2. 实物识别率 (实际 .shadow/ 文件)

| 字段 | 值 |
|------|-----|
| 实际文件数 | {total} |
| 识别数 | {identified} |
| unknown 数 | {unknown} |
| **识别率** | **{pct}%** |
| 阈值 (R5 硬阻断) | 80% |

未识别文件清单(若识别率 < 80% 则本节必填):

```
{unknown_files}
```

## 3. 5 硬门禁执行结果

### R1 — 设计基线改动传播

| 字段 | 值 |
|------|-----|
| 24h 内 design_baseline 修改 | {count} |
| 警告 | {warn} |
| 状态 | {pass/warn} |

### R3 — 证据写阻断

| 字段 | 值 |
|------|-----|
| evidence_archive 路径 | {paths} |
| 可写文件 (被修复) | {count} |
| 状态 | {pass/repaired} |

### R5 — 漂移扫描

| 字段 | 值 |
|------|-----|
| 漂移数 | {drift} |
| 阈值 | 0 |
| 状态 | {pass/fail} |

### R6 — 路径 locality

| 字段 | 值 |
|------|-----|
| .shadow/ 顶层目录 | {count} |
| 不在 schema 登记 | {unknown} |
| 状态 | {pass/warn} |

### R10 — 自动 .archived 锁

| 字段 | 值 |
|------|-----|
| evidence_archive 路径 | {paths} |
| 已 .archived 文件 | {count} / {total} |
| 状态 | {pass/partial} |

## 4. 漂移案例(若识别率 < 100%)

{按 lifecycle_role_of 返回 unknown 的文件,每行一条,标注"建议 canonical_path / alias 收纳 / 不登记"}

## 5. 处置建议

{基于上面 4 节的处置方案:
- 漂移 → aliases 收纳 / 改名 / 不动
- 修复 → chmod 444 / 加 .archived
- 阈值 → 调高 / 调低
}

## 6. 验证步骤

```bash
# 重跑 gate-check
bash skills/shadow-artifact-lifecycle/scripts/gate-check-lifecycle.sh

# 查任意文件角色
source hooks/lib.sh && load_shadow_schema
lifecycle_role_of <path>

# 列某角色所有工件
lifecycle_paths_by_role design_baseline
```

## 7. 相关文档

- `shadow-schema.json:lifecycle_artifacts[]` 单一源真理
- `CLAUDE.md` § 7 工件生命周期 (5 类角色)
- `agents/shadow-walker.md` 变更传播表 + 迭代管理段
- `references/lifecycle-taxonomy.md` 5 角色深度
- `references/drift-examples.md` 7+ 真实项目漂移案例
