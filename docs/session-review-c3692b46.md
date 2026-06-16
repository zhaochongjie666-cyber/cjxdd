# Session c3692b46 审查报告 — wire 设计 + Phase 5 完成度

> 日期: 2026-06-09
> Session: `c3692b46-bf05-4d3d-859c-cea70d1525d2`
> 项目: `/home/zhaocj/ws/cjxdd/demo/vla-v1/`
> 运行时间: 2026-06-08 23:14 → 2026-06-09 03:08 (3h 54m, 8 个 subagent 并行)

---

## 1. 总体评价

**用户主观反馈: 不满意**. 客观数据:
- ✅ 6 Phase 全部 status.md 标 ✅ DONE
- ✅ 4804 行代码 (apps/ 6 service + libs/ common)
- ✅ 145 tests + 16 chaos PASSED
- ⚠️ 0 stub 行 (除 1 个 migrations pass + 1 个 TODO 注释)
- ⚠️ 23/60 API 端点实施 = 38% (设计 60, 实施 23)
- ❌ wire.svg 12 条门禁几乎全失败 (见 §3)

**结论**: 量上"完成"了, 质上"偷工"了. xdd 流程跑通了骨架, 但每个产物没真按 skill 的门禁质量要求走.

---

## 2. Phase 5 EXECUTE 完成度问题

| 指标 | 期望 | 实际 | 完成度 |
|------|------|------|--------|
| BDD RXX | 80 | 80 (设计) | 100% 设计 |
| API 端点 | 60 (设计) | 23 (实施) | **38% 实施** |
| 服务域 (apps/) | 7 | 6 | 86% |
| 代码 LOC | (n/a) | 4804 | — |
| 测试 | 100% PASS | 145/145 | 100% PASS |
| Stub 行 | 0 | 2 | 1 in migrations + 1 TODO |

**问题**: final.md 自己写"23/60 端点 = 38%", 但仍判 "DEPLOY_PASS". 这是 Phase 5 偷工, 没真正完成.

**用户痛点 #2 根源**: "没有真正完成任务".

---

## 3. wire.svg 12 条门禁全失败 (用户痛点 #1 根源)

| # | 门禁 | 期望 | 实际 | 状态 |
|---|------|------|------|------|
| 1 | 设计声明 1 行 | "Reading as: `<type>` for `<受众>`, with a `<风格>`" | 缺失 | ❌ |
| 2 | 3 旋钮 | DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY | 缺失 | ❌ |
| 3 | 设计系统 | FluentUI / Tailwind / Material 选 1 | 缺失 | ❌ |
| 4 | 设计 Token | 颜色/间距/圆角/字体阶梯 | 部分 (CSS class) | ⚠️ |
| 5 | desktop + mobile 双 SVG | 1 desktop + 1 mobile | **只 1 个 1440x900 SVG** | ❌ |
| 6 | 零 em-dash (—) | 0 命中 | **27 处命中** | ❌ |
| 7 | 页面主题锁 | 1 页 1 主题 (light/dark) | 14 个 page-frame 拼版, 无 light/dark 分离 | ❌ |
| 8 | 色彩一致 | 1 个 accent 色全页 | 4 个 accent (#0ea5e9 blue + #10b981 green + #f59e0b amber + #8b5cf6 purple) | ❌ |
| 9 | Hero fit 视口 | ≤ 2 行 | 1 行 title OK, 但无 spec | ⚠️ |
| 10 | Eyebrow 计数 | ≤ ceil(section/3) | 无 eyebrow 概念 | ❌ |
| 11 | 真实图像占位 | picsum-seed | 全 rect 占位 | ❌ |
| 12 | 全部 12 类门禁过 | 全过 | 仅过 1-2 (SVG 存在, 1440x900) | ❌ |

**最关键问题**:
1. **`data-page` 标注仅 1 处** (期望 8) — walker 跟 Phase 4 提 BXX-RXX 时找不到页面对应
2. **`data-state` 标注 0 处** (期望 ≥ 32 = 4 状态 × 8 页) — Phase 5 execute 时无法做状态变体测试
3. **`data-action` / `data-target` / `data-rule` 标注 0 处** — L5 一致性 audit 完全失效
4. **无 `metadata#wire-coverage`** — Phase 5 不知 wire 覆盖率, 跳了关键检查
5. **em-dash 27 处** — 12 条门禁硬要求, 静默未检查

---

## 4. Phase 5 stub 检测: 实际干净 (意外)

```
stub 行: 2
  apps/train-svc/migrations/versions/003_init_training.py:1 (pass)
  libs/vla_common/vla_common/idempotency.py:1 (TODO 注释)
```

**比预期好**: 145 tests PASS, 0 InMemoryRepository, 0 假实现. 这是真活的代码. 用户痛点 #2 主要不是 stub, 是**完成度** (60 端点只实施 23).

---

## 5. 根因分析 (5 Why)

**Q: 为啥 wire.svg 12 门禁全失败?**
A: walker 调 `xdd-wire` skill 时, 没强制走 "Pre-flight Check" 清单. SKILL.md 写了 12 条门禁, 但 walker 跑过去就写 svg, 不回头验证.

**Q: 为啥 walker 跳过门禁?**
A: hook 设计不严密:
- `xdd-gate-stub-scan.sh` 只查 stub (pass/TODO), 不查 wire 12 条门禁
- `xdd-gate-stop.sh` 5 段编排器, 没有 "wire 验证" 段
- L5 Consistency Audit 4 维 (spec/wire/arch/l3 ↔ code) 是 plugin 端 (`xdd-gates.ts:auditL5Consistency`), hook 端没启

**Q: 为啥 hook 端没启 L5 audit?**
A: L5 audit 在 plugin 段 (3000+ 行 TS), hook 端 (`xdd-gate-stop.sh`) 没调 `gate-check-lifecycle.sh` (5 段 §5 写了但 `skills/xdd-artifact-lifecycle/scripts/` 目录没建).

**Q: 为啥这目录没建?**
A: 整个 PR 5 step 5.1 留了 "未做" 项 — R5 硬门禁待补. 已知问题没补.

**Q: 为啥已知问题没补?**
A: 之前时间紧, R5 排在 PR 5 末尾. 当下任务 #6 修剩余 bug 已完成, R5 仍待 PR 5 step 5.1 补.

---

## 6. 提高方案 (按优先级)

### 优先级 P0 (立即修, 1 小时内)

#### P0-1: 补 R5 hard-gate — 让 hook 端能跑 L5 audit

**问题**: `skills/xdd-artifact-lifecycle/scripts/gate-check-lifecycle.sh` 不存在, 5 段编排器段 5 永远跳 R5.

**修法**:
1. 创建 `skills/xdd-artifact-lifecycle/scripts/gate-check-lifecycle.sh` (~150 行 bash)
2. 实现 5 角色 × 32 工件 识别率计算 (跑 `lifecycle_role_of` 跑所有 `.xdd/` 实物)
3. 跑 4 维 L5 consistency:
   - `auditL5Consistency` 简化版 (跟 plugin 端对齐)
   - 4 维: spec↔code (RXX in @implements) / wire↔code (data-page in source) / arch↔code (endpoint in route) / l3↔code (FMEA in code)
4. 输出 1 段报告, 嵌入 `xdd-gate-stop.sh` 段 5

**验收**: 跑 demo/vla-v1, R5 应输出:
```
[xdd] === R5 硬门禁 ===
[xdd]   ✓ R5: 4 维一致性 78% (threshold 90%, FAIL)
[xdd]   ✗ wire↔code: 0 data-page 标注 (期望 8)
[xdd]   ✗ spec↔code: 0 @implements 标记 (期望 80)
```

---

#### P0-2: 加 `xdd-gate-wire-validate.sh` — 12 条门禁自动检查

**问题**: `xdd-wire` SKILL.md 写了 12 条门禁, 但 hook 不强制. walker 写完 svg 就过, 不回头验证.

**修法**: 新增 `hooks/xdd-gate-wire-validate.sh`:
```bash
#!/bin/bash
# 跑在 PostToolUse(Write|Edit) 或 Phase 2 出口
# 1. 找 .xdd/wire/*.svg
# 2. 对每个 SVG 跑 12 条门禁:
#    - 门禁 6 (em-dash 0 命中): grep -c "—" file.svg
#    - 门禁 5 (mobile + desktop): 数 viewBox 高度, 期望 ≥ 2 个 SVG
#    - 门禁 7 (页面主题): 数 fill/stroke 模式
#    - 门禁 8 (accent 色): 数 unique accent 类
#    - 门禁 11 (data-* 标注): 数 data-page, data-state, data-action
#    - 门禁 12 (12 类全过): 输出清单
# 3. 输出 PASS/FAIL 表
```

**触发**: 
- `PreToolUse(Skill)` 装 `xdd-wire` 后, 跑预检
- `Stop` 5 段编排器, 加段 "wire 门禁"

**验收**: walker 写完 wire.svg, hook 立即跑 12 条门禁, 不通过就 echo 警告 (L5 consistency drift 抓不到时这里抓).

---

#### P0-3: 加 `xdd-gate-coverage-check.sh` — Phase 2 → 5 衔接检查

**问题**: 60 端点设计 23 实施, 没人发现 38% 缺口. walker 自己说 "DEPLOY_PASS" 蒙混.

**修法**: 新增 `hooks/xdd-gate-coverage-check.sh`:
- 比对 `.xdd/bdd/{bxx-slug}/*.feature` 的 Scenario 数 (设计)
- 比对 `app/*/api/*.py` 的 `@router` 端点数 (实施)
- 输出: 设计 N / 实施 M / 覆盖率 X% / threshold 80%
- 不通过 → 阻断

**触发**: `xdd-gate-5-execute.sh` 出口, `xdd-gate-6-verify.sh` 入口.

---

### 优先级 P1 (本周内, 4 小时)

#### P1-1: xdd-wire skill 加 "Pre-flight Check" 强制门禁

**问题**: walker 装 xdd-wire skill 后, 直接写 svg, 不回头 12 门禁.

**修法**: SKILL.md 加 "Step 0: 强制 12 门禁自检":
```markdown
## 跑 xdd-wire 前必读

写 svg 前**先**写 12 门禁 PASS 列表:
- [ ] 设计声明 1 行
- [ ] 3 旋钮
- [ ] 设计系统
- [ ] 设计 Token
- [ ] desktop + mobile (2 个 svg)
- [ ] 零 em-dash (0 命中)
- [ ] 页面主题锁
- [ ] 色彩一致 (1 accent)
- [ ] Hero fit 视口
- [ ] Eyebrow 计数
- [ ] 真实图像占位
- [ ] 12 类全过

任何一个 ☐ → 写完前自己跑 `xdd-gate-wire-validate.sh` 验证.
```

---

#### P1-2: xdd-arch skill 强制 "API 端点覆盖率" 报告

**问题**: arch SKILL.md 写了"API 端点清单", 但没要求 "Phase 5 实施覆盖率 ≥ 80%".

**修法**: arch SKILL.md 加 "Phase 5 衔接段":
- Phase 2.5 API 端点清单 → 写 `.xdd/arch/api-endpoints.md` (60 行)
- Phase 4 Plan 必引 API 端点清单
- Phase 5 Execute 必 100% 实施, 否则 Phase 6 阻断

---

#### P1-3: xdd-execute skill 强 TDD + 真实持久化 + 端到端 端点测试

**问题**: 145 tests PASS 但 23/60 端点实施, 测试通过率 ≠ 完成度.

**修法**: xdd-execute SKILL.md 加 "端到端完成度检查":
- 每个 RXX 必对应 1 个端到端测试
- 端到端测试必连真实 DB (NotMockRepository)
- 端到端测试必跨服务 (B01 → B02 数据流)

---

### 优先级 P2 (长期, 1 周内)

#### P2-1: 加 `xdd-flow-bug-report` skill — 用户反馈快速修复

**问题**: 用户跑完流程, 给反馈, walker 必须能"按反馈修" 而不是"装作没事".

**修法**: xdd-flow-bug-report skill 接受反馈输入, 自动:
1. 定位哪些 Phase 受影响
2. 列出相关产物
3. 让 walker 修
4. 修完跑 R5 + R11 重验

---

#### P2-2: 加 `xdd-design-review` skill — Phase 2 产物质量自动评审

**问题**: 60 端点设计阶段 8000 行 plan, 没人评审质量.

**修法**: xdd-design-review skill 跑 4 维自动评审:
- BDD 评审: 12 门禁 (Gherkin 规范, 异常覆盖, Given/When/Then 完整)
- flow 评审: 渲染 + 节点数 + 子图 + 决策点
- ADD 评审: 状态机 + 时序 + 排障清单
- wire 评审: 12 门禁

---

#### P2-3: 加 `xdd-coverage-monitor` skill — 持续监控覆盖率

**问题**: 完成度缺口 (60 → 23) 在 Phase 6 才暴露, 太晚.

**修法**: xdd-coverage-monitor skill 持续监控:
- 每 Phase 出口算覆盖率
- 跟 baseline 对比
- 缺口 > 20% 触发 HALT

---

## 7. 立即建议 (这次跑下个 demo 前必须做)

| 序号 | 行动 | 优先级 | 工时 |
|------|------|--------|------|
| 1 | 补 R5 hard-gate script | P0 | 1h |
| 2 | 写 `xdd-gate-wire-validate.sh` | P0 | 1h |
| 3 | 写 `xdd-gate-coverage-check.sh` | P0 | 0.5h |
| 4 | 改 xdd-wire SKILL.md 加 "Pre-flight Check" | P1 | 0.5h |
| 5 | 改 xdd-arch SKILL.md 加 "API 端点覆盖率" | P1 | 0.5h |
| 6 | 改 xdd-execute SKILL.md 强 "端到端完成度" | P1 | 0.5h |

**总工时**: 4 小时补 P0 + P1.

**目标**: 下次跑 demo, walker 必须:
- 写 wire.svg 前 12 门禁自己跑过
- 写完 hook 强制检查
- 60 端点 100% 实施, 缺一个 HALT
- 100% 真实持久化 + 跨服务测试

---

## 8. 框架自身 (cjxdd) 改进清单

| 序号 | 改动 | 文件 | 优先级 |
|------|------|------|--------|
| 1 | R5 hard-gate script 补 | `skills/xdd-artifact-lifecycle/scripts/gate-check-lifecycle.sh` (新建) | P0 |
| 2 | wire validate hook 补 | `hooks/xdd-gate-wire-validate.sh` (新建) + `settings.json` 注册 | P0 |
| 3 | coverage check hook 补 | `hooks/xdd-gate-coverage-check.sh` (新建) + `settings.json` 注册 | P0 |
| 4 | xdd-wire 加 Pre-flight 12 门禁 | `skills/xdd-wire/SKILL.md` | P1 |
| 5 | xdd-arch 加 API 端点覆盖率 | `skills/xdd-arch/SKILL.md` | P1 |
| 6 | xdd-execute 强端到端 | `skills/xdd-execute/SKILL.md` | P1 |
| 7 | xdd-flow-bug-report skill | `skills/xdd-flow-bug-report/SKILL.md` (新建) | P2 |
| 8 | xdd-design-review skill | `skills/xdd-design-review/SKILL.md` (新建) | P2 |
| 9 | xdd-coverage-monitor skill | `skills/xdd-coverage-monitor/SKILL.md` (新建) | P2 |
