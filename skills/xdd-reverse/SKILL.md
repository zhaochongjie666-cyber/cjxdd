---
name: xdd-reverse
alias: Shadow·Reverse
description: |
  [Internal] Shadow Reverse — 逆向工程, 从代码反推设计 (L5 back to L1).
  触发: 逆向工程、反推、从代码生成设计文档、遗留项目分析、建立影子仓库基线.
version: "1.0.0"
---

# Shadow Reverse

## 角色职责

[Internal] Reverse Worker — reverse-engineers .shadow/ from existing code (L5 back to L1).

## 三阶段执行

| 阶段 | 名称 | 任务 |
|:----:|:-----|:-----|
| A | 结构骨架 | 扫描代码结构，生成 Harness 计划 |
| B | 证据补全 | 按业务线补全设计文档 |
| C | Git 审计 | 分析 Git 历史，确定时间线和意图 |

## 与 shadow-trace-init 的关系

| 场景 | 使用 Skill |
|------|-----------|
| 档位 D（野生项目，无 .shadow） | 先 shadow-reverse → 再 shadow-trace-init |
| 档位 A-C（有部分 .shadow） | 直接使用 shadow-trace-init |

## 执行步骤

### Step 1: 结构骨架扫描

扫描代码结构，生成 Harness 计划：
- 识别主要模块和接口
- 提取函数签名和参数类型
- 生成 plan.md

### Step 2: 证据补全

按业务线补全设计文档：
- 分析代码逻辑，推断业务规则
- 生成 L1 设计文档（research.md, spec.md）
- 建立与现有代码的关联

### Step 3: Git 审计

分析 Git 历史，确定时间线和意图：
- 查看提交历史
- 分析代码演进路径
- 确定设计意图

### Step 4: 生成报告

输出：
- Harness 计划文件
- L1 设计文档（反推）
- 逆向工程报告

## 交接协议

shadow-reverse 完成后输出 `.shadow/reverse-complete`，触发 shadow-trace-init 继续处理。
