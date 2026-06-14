---
name: shadow-trace-init
description: |
  [Internal] Trace initialization — builds L1-L5 bidirectional traceability (@implements tags, INDEX.md, trace.md). Dispatched from the main `shadow` skill. Do not trigger directly.
version: 1.0
---

# Trace Init — 已有项目追溯初始化

## 角色

为**已有项目**（非从零开发）建立完整的 L1 ↔ L5 双向追溯链。自动识别项目当前状态，执行对应策略，生成 INDEX.md、trace.md，补全 @implements 标记。

## 项目状态自动检测

启动时扫描项目，判断属于哪一档：

```
档位判定逻辑:
  IF 无 .shadow/ 目录
     → 🟡 档位 D（野生项目）→ 需要完整逆向
  ELSE IF business/ 存在且有 spec.md
     AND L5-plan/ 存在且有 @implements
     AND 代码中有 @implements
     → 🟢 档位 A（完整项目，缺索引）
  ELSE IF business/ 存在且有 spec.md
     AND (L5-plan 无 @implements OR 代码无 @implements)
     → 🟡 档位 B（有设计，缺标记）
  ELSE IF 代码中有 @implements
     AND (business 不完整 OR 目录结构混乱)
     → 🟡 档位 C（有代码标记，缺整理）
  ELSE
     → 🔴 档位 B-（有部分 .shadow 但无标记）
```

## 各档位策略

### 🟢 档位 A：完整项目，缺索引

**典型特征**：L1 spec ✅ + L5 Plan @implements ✅ + L5 代码 @implements ✅

**执行步骤**：

1. **整理目录结构**
   - 确认 `.shadow/business/BXX-<slug>/` 目录存在
   - 项目级流程总图固定为 `.shadow/business/project.flow.mermaid`
   - 业务线标准文件名固定为 `research.md` / `spec.md` / `wire.svg`

2. **生成 INDEX.md**
   - 扫描 `business/` 下所有 slug 子目录
   - 提取每个 slug 的规则数（从 spec.md 中 grep `-R\d+`）
   - 识别主业务（规则最多的或用户指定）
   - 生成 `.shadow/business/INDEX.md`

3. **运行追溯工具**
   - `bash skills/shadow-trace-init/scripts/trace.sh matrix > .shadow/business/TRACE.md`
   - 对每个 slug 运行 `bash skills/shadow-trace-init/scripts/trace.sh coverage <slug>`

4. **输出报告**
   - 显示覆盖矩阵摘要
   - 列出未覆盖规则（⚠️）
   - 列出无测试规则（🟡）
   - 列出孤立代码文件（无 @implements 的源文件）

### 🟡 档位 B：有设计，缺标记

**典型特征**：L1 spec ✅ + L5 Plan 存在但无 @implements + 代码无 @implements

**执行步骤**：

1. **整理目录结构**（同档位 A 步骤 1）

2. **生成 INDEX.md**（同档位 A 步骤 2）

3. **从 spec 反推 @implements**（核心难点）
   - 读取 `spec.md` 中所有规则 ID（R01, R02, ...）
   - 对每条规则，分析其描述中的关键词（API路径、组件名、操作类型）
   - 扫描 L5 Plan 文件内容，匹配规则关键词
   - 为每个 plan.md 推断并写入 `@implements: slug-Rxx`
   - 扫描 L5 代码文件，匹配 L5 Plan 中的 @implements
   - 为代码文件补写 `@implements` 标记

4. **确认标记准确性**
   - 生成映射草案
   - 向用户展示推断结果，确认或修正
   - `规则 R01 → 推断文件: auth.py, auth_service.py → 确认? [Y/n]`

5. **生成追溯矩阵**
   - `bash skills/shadow-trace-init/scripts/trace.sh matrix > .shadow/business/TRACE.md`

### 🟡 档位 C：有代码标记，缺整理

**典型特征**：L5 代码有 @implements ✅ + L1 spec 不完整或目录混乱

**执行步骤**：

1. **从代码 @implements 反推 L1 spec**
   - 扫描所有代码文件中的 `@implements: <slug>-Rxx`
   - 提取所有唯一的 slug 和规则 ID
   - 对比现有 L1 spec.md 中的规则，找出差异
   - 代码中标记但 spec 中缺失的规则 → 标记为需补充
   - spec 中存在但代码中无标记的规则 → 标记为未实现

2. **整理 business 目录结构**
   - 按 slug 归类
   - 补齐缺失的 spec 条目（从代码注释中推断规则描述）

3. **生成 INDEX.md + trace.md**（同档位 A）

### 🔴 档位 D：野生项目

**典型特征**：无 .shadow 或仅有零星产出

**执行步骤**：

1. 读取 `tools/reverse/reverse.md` 进行完整逆向工程
2. reverse 完成后，回到档位 A 流程生成 INDEX.md + trace.md

---

## 档位 E：结构标准化

当 `.shadow/` 已存在但不符合当前目录式标准时：

1. 将 L1 文件整理为项目级 `business/project.flow.mermaid` + 业务线级 `business/<slug>/research.md|spec.md|wire.svg`
2. 将 L1.5 文件整理为 `arch/<slug>/architecture.md|file-list.md|quality.md|api-contract.yaml`
3. 将 L2 文件整理为 `L2-e2e/<slug>/e2e.md`
4. 将 L6 文件整理为 `verifyment/<slug>/deployment-report.md`
5. 统一语义 Gate 报告路径为 `reviews/semantic-gate.md`
6. 重新生成 `INDEX.md`、`TRACE.md` 并运行 `bash skills/shadow-trace-init/scripts/trace.sh coverage <slug>`

---

## 执行步骤（通用）

### Step 1: 项目扫描

```bash
# 扫描 .shadow 完整度
find .shadow -maxdepth 2 -type d | sort

# 扫描 @implements 分布
grep -r "@implements" --include="*.py" --include="*.ts" --include="*.tsx" . | grep -v ".shadow" | wc -l
grep -r "@implements" .shadow/L5-plan/ 2>/dev/null | wc -l

# 扫描 L1 spec
find .shadow/business -name "spec.md" 2>/dev/null

# 识别 slug
ls .shadow/business/ 2>/dev/null
```

### Step 2: 档位判定

基于扫描结果判定档位 A/B/C/D，加载对应策略。

### Step 3: 目录整理

统一目录结构为：
```
.shadow/business/
├── INDEX.md
├── project.flow.mermaid
├── <slug1>/
│   ├── spec.md
│   ├── wire.svg
│   ├── reviews/semantic-gate.md
│   └── research.md
└── <slug2>/
    └── ...
```

### Step 4: 标记补全（档位 B 核心）

**匹配策略**（按优先级）：

| 策略 | 方法 | 准确率 |
|------|------|:------:|
| 文件名匹配 | plan.md 文件名含 API/组件名 → 匹配 spec 中同关键词规则 | ~70% |
| 内容语义匹配 | plan 描述中的关键词与 spec 规则描述比对 | ~80% |
| L1.5 file-list 映射 | 从 L1.5 的 file-list.md 中获取规则→文件映射 | ~90% |

多条策略交叉验证，一致时自动写入 @implements，不一致时标记需人工确认。

### Step 5: INDEX.md 生成

```markdown
# L1 业务索引

> 自动生成于 YYYY-MM-DD HH:mm:ss · 追溯初始化

| 业务 Slug | 业务名称 | 主业务 | 状态 | 规则数 | 代码覆盖 | 测试覆盖 | 创建时间 | 最后更新 |
|-----------|---------|:------:|:----:|:------:|:--------:|:--------:|----------|----------|
| slug-1 | 业务1名称 | ⭐ | ✅ passed | N | M/M | K/N | auto | auto |
```

### Step 6: trace.md 生成

```bash
bash skills/shadow-trace-init/scripts/trace.sh matrix > .shadow/business/TRACE.md
```

### Step 7: 输出报告

向用户展示：

```
=== 追溯初始化完成 ===

INDEX.md  ✅ 已生成（N 个业务线）
TRACE.md  ✅ 已生成（双向追溯矩阵）

📊 覆盖统计:
  总规则数:    XX
  有代码实现:  XX/XX (XX%)
  有测试覆盖:  XX/XX (XX%)
  完整覆盖:    XX/XX (XX%)

⚠️  待处理:
  未实现规则:  R05, R12, R18
  无测试规则:  R03, R07, R15
  孤立代码:    helpers.py, utils.ts (无 @implements)

📝 下一步:
  1. 确认 @implements 标记推断结果
  2. 补全未实现规则的代码
  3. 为无测试规则补充测试
```

## 关键约束

- **档位 E 迁移必须先备份**（`.shadow.backup.YYYYMMDD`）
- **HTML→SVG 优先重新生成**（而非手动转换），确保符合最新标准
- **目录重命名不可逆**，确认后再执行
- **@implements 推断必须向用户确认**（档位 B）
- **保留原始文件**，不删除，仅移动到新位置
- **INDEX.md 主业务标注（⭐）**需用户确认或按规则数自动选择
- **完成后验证**：运行 `bash skills/shadow-trace-init/scripts/trace.sh coverage` 检查追溯链完整性
- **迁移完成后删除备份**（确认无误后）
