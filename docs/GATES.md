# xdd 11 个 Gate 编排器总览

> **本文件目的**: 解释 xdd 自动化护栏层的所有 gate, 抓什么 / 力度 / 实施位置

---

## 1. Gate 总览表

| ID | 抓什么 | 力度 | 实施位置 |
|----|--------|------|---------|
| **R3** | 关键证据是否写了 (L6 wander/chaos/issues.json) | 软警告 | `xdd-gate-stub-scan.sh` |
| **R5** | 5 角色 lifecycle 一致 | **hard** | `xdd-gate-stop.sh` |
| **R10** | iter 完成时归档 | 自动 | `xdd-gate-stop.sh` |
| **R11** | 4 层验证 (marker / 解析 / 测试 / hash) | **新项目 hard, 老项目 advisory** | `plugins/xdd-gates.ts:§9` |
| **L0 重做** | per-iter 14 天 mtime | Round 1 软警告, Round 2 计划 hard | `xdd-gate-pre-skill.sh` |
| **L5 Consistency** | 4 维 (spec↔code / wire↔code / arch↔code / l3↔code) ≥ 0.9 coverage | **hard** | `plugins/xdd-gates.ts:auditL5Consistency` |
| **L5 5 段 stop-gate** | stub / pending / drift / lifecycle / R5 | **全 hard (no-advisory)** | `xdd-gate-stop.sh` |
| **L5 unresolved 跨轮保活** | L5 warning 跨轮可见 | 软压力, 3 试升 hard | `plugins/xdd-gates.ts:§11` |
| **3 试 HALT** | unresolved.count > 3 升级 HALT | **hard** | `.xdd-halt.json` + L1 system 注入 |
| **bypass-shdw:** | 显式 bypass 必带 reason | audit log | L5 stop-gate 段 1.5 |
| **zh-continue** | 模糊词触发 hook hint → server 拒收 | **hard (fix)** | `xdd-gate-user-prompt-submit.sh` 静默 |
| **5 段压力信号** | RUSH/TIME/SKIP/SIMPLIFY/WORKLOAD | 软提醒 | `hooks/xdd-gate-lib.sh:check_pressure_signals` |
| **API error 兜底** | 内容过滤 / 限流 / 鉴权 / 5xx 等 | warning/error toast | `plugins/xdd-gates.ts:§14` |

---

## 2. 11 个 xdd-gate 详细

### 2.1 xdd-gate-meta.sh

**触发**: 单独调用 / 任何其他 gate 加载时

**行为**:
- 检测 CWD 是否是 cjxdd 仓库自身 (agents/xdd-walker.md + skills/xdd-init/SKILL.md + hooks/xdd-gate-lib.sh 都在)
- 是 → 输出警告, 提示用户直接改 framework 源码
- 否 → 继续常规 gate 流程

**退出码**: 0 = Meta, 1 = 非 Meta, 2 = 无项目

### 2.2 xdd-gate-session-start.sh

**触发**: Claude Code `SessionStart` hook

**行为**:
- 注入当前 stage 上下文 (Phase / skill / expected output / next stage)
- 注入 5 步节奏提示
- Meta 旁路: 改 framework 时跳过

### 2.3 xdd-gate-user-prompt-submit.sh

**触发**: Claude Code `UserPromptSubmit` hook

**行为**:
- 检测 "build me X" / "做一个 XX 系统" → 提示加载 xdd-walker
- 检测 stage 状态查询 ("当前阶段" / "下一阶段") → 回答
- 压力信号检测 (5 类)
- zh-continue 静默 (防止 OpenCode server 拒收)
- Meta 旁路: 改 framework 时跳过意图引导

### 2.4 xdd-gate-pre-skill.sh

**触发**: Claude Code `PreToolUse(Skill)` hook

**行为**:
- 5 步节奏打印
- L0 重做门禁 (每轮 iter 14 天 mtime)
- P0-Z wire 变体简化检测
- 阶段顺序硬阻断 (exit 2: 跳阶段)

### 2.5 xdd-gate-stub-scan.sh

**触发**: Claude Code `PostToolUse(Write|Edit)` hook

**行为**:
- 写完代码实时扫存根 (pass / TODO / return None / NotImplementedError)
- 工匠底线 #1: 不写存根
- 工匠底线 #2: 不用假实现

### 2.6 xdd-gate-stop.sh

**触发**: Claude Code `Stop` hook

**行为** (5 段编排器):
1. stub scan (源目录)
2. Bypass audit log (informational)
3. pending stages (按 BXX 分组)
4. L5 stage drift
5. lifecycle drift
6. R5 hard-gate
7. L6 smoke-test-passed 4 层验证 (R11)
8. L5 Consistency Audit 4 维

### 2.7 xdd-gate-team-dispatch.sh

**触发**: Claude Code `PreToolUse(Task)` hook

**行为**:
- 派 worker 时检查 prompt 是否引用 work order
- 引用了但文件不存在 → 警告
- 都没引用 → 提示先写 WO

### 2.8 xdd-gate-pressure.sh

**触发**: 独立调用 (UserPromptSubmit / PreToolUse 内部)

**行为**:
- 检测 5 类压力信号 (RUSH / TIME / SKIP / SIMPLIFY / WORKLOAD)
- 软提醒 (不阻断, 但提醒 AI 保持 5 步节奏)

### 2.9-2.14 xdd-gate-0/1/2/3/4/5/6 (Phase 出口 gate)

**触发**: 各 Phase 完成时调用 (或 L5 stop-gate 自动检查)

**行为**:
- Phase 0: `.xdd/` 存在 + scale.md 含 strict_mode
- Phase 1: status.md Phase 1 行 ✅
- Phase 2: BDD 工件存在
- Phase 3: 用户确认 (主要靠 user-prompt-submit 检测)
- Phase 4: plan 文件 17 项自检 (无 TBD/TODO + 必要段齐全)
- Phase 5: BDD 覆盖追踪表全 [x] + 全量测试 PASS
- Phase 6: 4 维审计 + L6 子阶段 (R11 marker)

---

## 3. R5 hard-gate 详细

`skills/xdd-artifact-lifecycle/scripts/gate-check-lifecycle.sh` 跑 5 角色一致性:

- schema 中所有工件都登记了角色
- canonical_path 路径模板合法
- 角色分布与当前阶段一致
- aliases[] 不指向已废产物
- 当前 `.xdd/` 实物文件被 `lifecycle_role_of` 识别率 ≥ 80%

**新项目 (有 LIFECYCLE.md)**: 识别率 < 80% → exit 1 (硬阻断)
**老项目 (无 LIFECYCLE.md)**: 仍 advisory (软警告)

---

## 4. R11 真实烟雾测试 (L6)

部署完成后, Walker 必须为每个 L6-deploy/{slug}/ 写 marker:

```bash
echo "${TS} | login E2E: POST /api/auth/login 200 + browser navigated to /home" \
    > .xdd/iterations/iter-N/L6-deploy/{slug}/smoke-test-passed
```

**新项目 4 层验证**:
- L1: marker mtime < 7 天
- L2: marker 首行正则 `production-scenarios @production: \d+ passed`
- L3: `prod-evidence/summary.json.failed == 0`
- L4: marker `prod-config-hash=...` == `prod-evidence/prod-config-hash.txt`

**老项目**: 只查 mtime (软警告)

---

## 5. 3 试 HALT 升级

`.xdd/iterations/{iter}/.l5-halt.json` 存在 → 强制回退设计层:

1. 回退上游 design (R03 业务约束翻译可能有误, 改 spec/arch)
2. 调 scale 字段 (改 .xdd/scale.md 把对应字段调到 L 级)
3. 走变更令 (走 xdd-walker 重新协调)
4. 写 `bypass-shdw: <具体原因>` 注释 (真要绕过, 必须带 reason 进 audit log)

不允许: 删 `.l5-halt.json` / 改 stub_patterns 配 schema 躲检查 / 装作没看见
