## L1 Gate — 业务流程暗影

> **Gate 采用双轨制：**
> 1. **脚本硬校验**：`bash skills/shadow-l1-flow/scripts/gate-check-l1.sh <slug>`
> 2. **独立语义审查**：使用本清单判断“是否能指导实现、是否人类可读、是否覆盖完整业务”
>
> 规则：**脚本 PASS 但语义 FAIL，仍然不通过。**

### 工具调用（收集事实）

```bash
# 0. INDEX.md 存在性
ls .shadow/L1-business/INDEX.md 2>&1

# 1. 文件存在性
ls .shadow/L1-business/project.flow.mermaid 2>&1
ls .shadow/L1-business/BXX-<slug>/research.md 2>&1
ls .shadow/L1-business/wire.svg 2>&1
ls .shadow/L1-business/BXX-<slug>/spec.md 2>&1

# 2. spec 必要章节
grep -c '^## \(业务目标\|角色\|业务规则\|可观测状态\|验收路径\)' .shadow/L1-business/BXX-<slug>/spec.md

# 3. 规则 ID 提取
grep -oP '<slug>-R\d+' .shadow/L1-business/BXX-<slug>/spec.md | sort -u

# 4. 状态 ID 提取
grep -oP '<slug>-S\d+' .shadow/L1-business/BXX-<slug>/spec.md | sort -u

# 5. flow 节点数 + resultNode 检查
grep -c 'resultNode' .shadow/L1-business/project.flow.mermaid
grep -cE '^\s+[A-Z]\[' .shadow/L1-business/project.flow.mermaid

# 6. Mermaid 基本语法
head -1 .shadow/L1-business/project.flow.mermaid
```

### 语义判断（AI 必做）

| # | 检查项 | PASS 标准 |
|---|--------|-----------|
| 1 | **实现指导性** | 工程师只看 L1 就能明确：接口/动作、状态、校验、错误、外部依赖、副作用 |
| 2 | **人类可读性** | 业务/产品能直接读懂规则，不需要先翻译工程黑话 |
| 3 | **业务完整性** | 不只写 happy path；主流程、异常、边界、权限、重试、回滚、人工介入都有覆盖 |
| 4 | **规则可实现** | 规则不是“系统处理”“必要时通知”这类空话，而是可直接转成代码逻辑 |
| 5 | **规则可验证** | 测试能从规则直接抽出可执行场景，不依赖二次猜测 |
| 6 | **状态清晰** | 关键对象生命周期清楚，进入条件/退出条件/非法转换明确 |
| 7 | **数据约束具体** | 字段、格式、唯一性、默认值、枚举、脱敏、保留期等足够明确 |
| 8 | **依赖与副作用明确** | 调用哪些系统、失败如何降级、有哪些通知/审计/日志/事件 |
| 9 | **UI/UX 契约完整** | 若有 wire 产物，通过 `wire.svg` 能看懂所有页面/弹窗/抽屉、所有状态、所有可交互点、所有反馈和跳转目标 |
| 10 | **UI 到代码可传导** | `wire.svg` 的页面/交互具备 `data-page/data-route/data-node/data-rule/data-action/data-target/data-state` 或 metadata/desc 摘要，L1.5/L5 能据此生成架构、契约、测试和实现 |
| 11 | **无明显模糊表达** | 不出现大量“相关/必要时/适当/做校验/处理异常/返回结果”式空泛描述 |

### 输出要求

独立语义审查必须输出：
- `PASS` / `FAIL`
- 至少 3 条具体依据
- 若 FAIL，明确指出缺失的是：实现指导性 / 人类可读性 / 业务完整性 中的哪一类

### 推荐执行方式

**方式 A：直接语义审查**
- 读取 `references/l1-semantic-gate-prompt.md`
- 对 `research.md / project.flow.mermaid / spec.md / wire 产物` 逐项审查
- 按 `references/l1-semantic-gate-report-template.md` 输出报告
- 写入 `{迭代作用域}/reviews/semantic-gate/l1.{slug}.md`
- ...
- 将结果落盘到 `{迭代作用域}/reviews/semantic-gate/l1.{slug}.md`
- ...
2. `{迭代作用域}/reviews/semantic-gate/l1.{slug}.md` 已生成（注：`{迭代作用域}` = `.shadow/iterations/{当前迭代}`）
3. `bash skills/shadow-l1-flow/scripts/check-semantic-gate-l1.sh <slug>` 返回 0
4. 若涉及页面交互，`wire.svg` 不得缺失 SVG 根节点、布局分区、完整页面/视图分组、关键状态、关键操作、关键反馈和实现传导标记

---
