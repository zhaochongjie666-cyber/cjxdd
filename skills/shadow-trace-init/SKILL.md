---
name: shadow-trace-init
alias: Shadow·TraceInit
description: |
  [Internal] Shadow Trace Init — 追溯初始化, 建立 L1-L5 双向追溯.
  触发: 追溯初始化、建立双向追溯、补全 @implements、生成 INDEX、已有项目接入 Shadow.
version: "1.0.0"
---

# Shadow Trace Init

## 角色职责

[Internal] Trace initialization — builds L1-L5 bidirectional traceability (@implements tags, INDEX.md, trace.md).

## 项目档位判定

| 档位 | 特征 | 处理策略 |
|:----:|:-----|:---------|
| A+ | 完整追溯链，INDEX/trace 齐全 | 只需更新 |
| A | 完整项目，缺索引 | 生成 INDEX + trace.md |
| B | 有设计，缺标记 | 补全 @implements，生成追溯 |
| B- | 有部分 .shadow，无标记 | 从现有产出补全标记 |
| C | 有代码标记，缺整理 | 整理代码标记，补设计文档 |
| D | 野生项目，无 .shadow | 调用 shadow-reverse 逆向工程 |
| E | 结构不符合标准 | 结构标准化 |

## 执行步骤

1. **档位扫描** — 扫描项目当前状态
2. **档位判定** — 确定当前档位
3. **策略选择** — 根据档位选择处理策略
4. **初始化执行** — 创建缺失文件、补全标记
5. **追溯验证** — 验证双向追溯完整性
6. **报告生成** — 生成追溯报告

## 与 shadow-reverse 的关系

| 场景 | 使用 Skill |
|------|-----------|
| 档位 D（野生项目） | 先 shadow-reverse 逆向，再 trace-init |
| 档位 A-C | 直接使用 shadow-trace-init |

## 输出

- `.shadow/INDEX.md` — 项目索引
- `.shadow/TRACE.md` — 追溯矩阵
- `.shadow/trace-init-report.md` — 初始化报告
