# xdd Demo Projects

> 本文件描述两个端到端 demo 项目, 验证 xdd 6 Phase 流程在真实产品项目中的工作方式.
>
> Demo 在仓库外的 `/tmp/` 目录, 跟 framework 自身 (cjxdd) 解耦. 详见 `framework-conventions.md` § 7 "Meta 项目边界".

---

## 1. S scale demo: `/tmp/test-xdd-product-s`

**规模**: 单业务线, 严格模式, 简版流水线 (跳过 2.5 Arch, 2.5 BDD 走 xdd-bdd 替代).

**strict_mode = true** (用户偏好) 但字段降级 (l3_extended_mode=false, persona_max=8, coverage_dimensions=14).

**结构**:
```
/tmp/test-xdd-product-s/
├── .xdd/
│   ├── xdd-version              # 0.1.0
│   ├── current-iteration        # iter-1
│   ├── scale.md                 # S 规模, strict-mode=true
│   ├── core/intent.md           # 业务意图
│   ├── bdd/login.feature        # 2 个 P0 Scenario
│   └── iterations/iter-1/pipeline/status.md  # 10 行阶段表
├── docs/
└── README.md
```

**验证步骤**:
```bash
cd /tmp/test-xdd-product-s

# 1. SessionStart 注入项目上下文
echo '{}' | bash ~/.claude/hooks/xdd-gate-session-start.sh
# 期望: project_root, shadow_dir, active_iter, pipeline state

# 2. UserPromptSubmit 检测意图
echo '{"user_prompt":"使用 xdd-walker 给我做一个登录"}' \
    | bash ~/.claude/hooks/xdd-gate-user-prompt-submit.sh
# 期望: 检测到新做意图, 提示加载 walker

# 3. PreToolUse(Skill) 装 xdd-bdd
echo '{"tool_name":"Skill","tool_input":{"skill":"xdd-bdd"}}' \
    | bash ~/.claude/hooks/xdd-gate-pre-skill.sh
# 期望: 5 步节奏, status.md 自动 ⏳ → 🔄 DOING

# 4. Stop 5 段编排器
echo '{}' | bash ~/.claude/hooks/xdd-gate-stop.sh
# 期望: 5 段编排器跑, 含 L5 Stage Drift 警告 (bdd 产物已存在, status.md 还 ⏳)
```

---

## 2. L scale demo: `/tmp/test-xdd-product-l`

**规模**: 3 业务线 (B01 用户 / B02 订单 / B03 库存), 严格模式 + `l3_extended_mode=true` (9 维 + 12 模式 + 8 字段).

**strict_mode = true** (全部字段按 L 级).

**结构**:
```
/tmp/test-xdd-product-l/
├── .xdd/
│   ├── xdd-version
│   ├── current-iteration
│   ├── scale.md                 # L 规模, strict-mode=true, l3_extended_mode=true, bxx_enabled=true
│   ├── core/intent.md           # 3 业务线意图
│   ├── bdd/                     # (待生成)
│   ├── arch/                    # (待生成, L 规模全规模触发)
│   ├── add/                     # (待生成)
│   ├── L3-resilience/           # (待生成, 9 维 + 12 模式 + 8 字段)
│   └── iterations/iter-1/pipeline/status.md
│       ## B01 / B02 / B03     # 多业务线维度
│       ## cross-BXX 一致性     # 6 项强制
├── docs/
└── README.md
```

**验证步骤** (同 S scale):
```bash
cd /tmp/test-xdd-product-l

# SessionStart 注入项目 + lifecycle 角色分布
echo '{}' | bash ~/.claude/hooks/xdd-gate-session-start.sh
# 期望: project_root, scale=L, lifecycle 5 角色分布

# Phase 2.5 Arch 必做 (L 规模全规模触发)
echo '{"tool_name":"Skill","tool_input":{"skill":"xdd-arch"}}' \
    | bash ~/.claude/hooks/xdd-gate-pre-skill.sh
# 期望: xdd-arch 装卸, status.md Phase 2.5 Arch → 🔄 DOING

# L3 韧性必做 (l3_required=true, l3_extended_mode=true)
echo '{"tool_name":"Skill","tool_input":{"skill":"xdd-l3"}}' \
    | bash ~/.claude/hooks/xdd-gate-pre-skill.sh
# 期望: xdd-l3 装卸, status.md Phase 3 L3 → 🔄 DOING (按 9 维 + 12 模式 + 8 字段扩展)
```

---

## 3. 怎么用 demo 跑完整 6 Phase

1. **进入 demo 目录**:
   ```bash
   cd /tmp/test-xdd-product-s   # 或 -l
   ```

2. **启动 Claude Code** (在 demo 项目里):
   ```bash
   claude   # Claude Code 启动时 SessionStart 注入 .xdd/ 上下文
   ```

3. **加载 walker** (对 Claude 说):
   > "使用 xdd-walker subagent 给我做一个登录系统"

4. **走 6 Phase**:
   - Phase 0: xdd-init (检测 .xdd/ 已存在, 直接 Phase 1)
   - Phase 1: xdd-l0 (发散调研, 写 9 份笔记本)
   - Phase 2: xdd-bdd → flow → add → wire → arch
   - Phase 2.5: BDD (含 Gherkin)
   - Phase 2.7: xdd-scaffold (7 步 Docker)
   - Phase 3: xdd-l3 (韧性) + 用户审查
   - Phase 4: xdd-plan (TDD 实施计划)
   - Phase 5: xdd-execute (按 Batch 串行)
   - Phase 6: xdd-l6 (部署 + 真实验证)

5. **每个 Phase 出口, 11 个 xdd-gate hook 自动检查**:
   - xdd-gate-session-start: 注入上下文
   - xdd-gate-pre-skill: 5 步节奏 + 阶段顺序硬阻断
   - xdd-gate-stub-scan: 写完代码实时扫存根
   - xdd-gate-stop: 5 段 hard-gate 编排器 (L5 consistency + R5 + L5 drift + lifecycle drift)

---

## 4. 期望产出对比 (S vs L)

| 维度 | S scale | L scale |
|------|---------|---------|
| 业务线 | 1 | 3 (B01 / B02 / B03) |
| scale 字段 | `S` | `L` |
| l3_extended_mode | false | **true** (9 维 + 12 模式 + 8 字段) |
| bxx_enabled | false | **true** (BXX 业务线分组) |
| 跨 BXX 一致性 | N/A | **强制** (6 项 checklist) |
| Phase 2.5 Arch | 跳过 (scale < M) | **必做** (L 规模全规模触发) |
| Phase 3 L3 | 5 字段 FMEA | **8 字段 FMEA + 跨地域 (F81-F85) + 业务对账 (FS11-a/b/c/d/e) + 业务幂等** |
| persona_max | 8 | 12 |
| coverage_dimensions | 14 | 20 |
| wire_passes | 2 | 4 |
| halt_after | 3 | 3 (no_advisory=true) |

---

## 5. 跟 framework 自身 (cjxdd) 的关系

| 区别 | framework (cjxdd) | demo 项目 |
|------|-------------------|----------|
| CWD | `/home/zhaocj/ws/cjxdd` | `/tmp/test-xdd-product-{s,l}` |
| Meta 守卫 | **是** (禁用 xdd 流程) | **否** (产品项目, 全流程开放) |
| .xdd/ 目录 | ❌ 没有 (META) | ✅ 必有 |
| status.md | ❌ 没有 | ✅ 必有 |
| 11 hook 行为 | 11 hook 大部分静默 (Meta bypass) | 11 hook 全部激活 (5 段编排器 + R5 + L5 consistency) |
| walker 加载 | ❌ 拒绝 | ✅ 正常 |

---

**完整 6 Phase 真实演示**: 进入 `/tmp/test-xdd-product-s`, 启动 Claude Code, 说 "使用 xdd-walker subagent 给我做一个登录系统" — walker 会走完整 Phase 0→6 流水线, 每个 Phase 出口由 11 个 xdd-gate hook 编排器自动检查.
