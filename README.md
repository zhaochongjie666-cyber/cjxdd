# Shadow — 带工具箱的工匠型开发体系

基于 OpenCode Agent + Skill 的全链路软件开发体系。一个 Agent（Shadow Walker）带一套工具箱（13 个核心 Skill），从调研到部署一个人把项目做到能交付。

## 架构

```text
Agent: shadow-walker（工匠，不是调度员）
  ↓ 按需加载 skill
Skills: 13 个核心工具 + 8 个小工具
  ↓ 产出到 .shadow/ 目录
产出: intent.md → flow → spec → wire → architecture → e2e → resilience → harness-plan → code → deploy
```

### 流水线

```text
骨架生成        ── shadow-init           ← 新项目第一步
30 发散调研      ── shadow-l0-research
31 业务层        ── shadow-l1-research → flow → spec → wire（串行）
规模判定          ── .shadow/scale.md（S/M/L）
31.5 架构        ── shadow-l1p5-architecture
搭脚手架          ── shadow-scaffold
32 验收场景      ── shadow-l2-e2e
33 韧性设计      ── shadow-l3-resilience  ← 8 维度失败模式穷举 + 10 个兜底模式 + 混沌测试场景 + 恢复剧本（全部规模强制）
35 执行计划      ── shadow-l5-plan
35 代码实现      ── shadow-l5-impl（按 Batch 串行）
全链路审查        ── shadow-reviewer（必经）
36 部署验证      ── shadow-l6-deploy
```



### L 规模扩展模式 (l3_extended_mode)

`.shadow/scale.md` 的 `l3_extended_mode` 字段控制 L 规模自动启用扩展:

| scale | l3_extended_mode (默认) | 输出 |
|-------|------------------------|------|
| S | false | 8 维 + 10 模式 + 5 字段 |
| M | false | 8 维 + 10 模式 + 5 字段 (建议补 12 模式) |
| **L** | **true** | **9 维 + 12 模式 + 8 字段** |

**L 规模扩 3 部分**:
- **9 维** = 8 维 + 跨地域/多活 (F81-F85: 机房级故障/跨地域一致性/异地同步/机房切换/跨地域延迟)
- **12 模式** = 10 模式 + 业务对账 (FS11) + 业务幂等 (FS12)
- **8 字段 FMEA** = 5 字段 + Owner + SLO 关联 + 回滚时长 (L 规模跨团队必填)

L 规模时, 必跑: 跨地域 5 个 P0 @chaos 场景 + 业务对账 5 类演练 (订单-支付/库存/物流/余额/优惠) + 业务幂等 5 类 (支付/订单/库存/优惠券/退款)。

## 目录结构

```text
agents/
  shadow-walker.md          # 工匠型 Agent

skills/
  shadow-init/              # 一键生成 .shadow/ 骨架（新项目第一步）
  shadow-l0-research/       # 30 发散笔记本（112 行）
  shadow-l1-research/       # 31 DDD+EDD+IDDD 业务调研（468 行）
  shadow-l1-flow/           # 31 MDD 流程总图（367 行）
  shadow-l1-spec/           # 31 FDD 业务规格（271 行）
  shadow-l1-wire/           # 31 SVG 线框图（486 行）
  shadow-l1p5-architecture/ # 31.5 ADD 架构设计（357 行）
  shadow-scaffold/          # 项目脚手架（255 行）
  shadow-l2-e2e/            # 32 BDD 验收场景（250 行）
  shadow-l3-resilience/     # L3 RDA 韧性设计（8 维度失败模式 + 兜底设计 + 混沌场景 + 恢复剧本）
  shadow-l5-plan/           # 35 Harness 精密执行计划（393 行）
  shadow-l5-impl/           # 35 代码实现（159 行）
  shadow-l6-deploy/         # 36 部署验证（247 行）
  shadow-reviewer/          # 全链路审查（222 行）
  skill-creator/            # Skill 创建标准（494 行）
  shadow-reverse/           # 逆向已有系统
  shadow-taste/             # 品味检查
  shadow-trace-init/        # 追溯初始化
  mermaid-check/            # Mermaid 渲染验证
  docker-helper/            # Docker 问题排查
  test-in-tmux/             # 测试运行

.shadow/shadow-schema.json         # 单一源真理：阶段表 / 存根模式 / scale 字段
                           #   hooks/*.sh + plugins/shadow-hooks.ts 都从这读

  # 每个 skill 目录结构：
  skill-name/
    SKI33.md                # 快速入门（< 500 行）
    references/             # 详细指南（按需读取）
    templates/              # 模板文件（部分 skill 有）
    scripts/                # Gate 检查脚本（部分 skill 有）

.claude/                    # Claude Code 兼容层（项目级）
  settings.json             #   hook 配置（CWD 在本项目时自动加载）
  hooks/
    lib.sh                  #   共用工具函数
    user-prompt-submit.sh   #   UserPromptSubmit hook
    session-start.sh        #   SessionStart hook
    pre-skill.sh            #   PreToolUse(Skill) hook
    post-write-stub-scan.sh #   PostToolUse(Write|Edit) hook
    stop-gate.sh            #   Stop hook

install-to-opencode.sh      # 装到 ~/.config/opencode/
install-to-claude-code.sh   # 装到 ~/.claude/，含 hooks 软链
install-to-pi.sh            # 装到 ~/.pi/ (PI_DIR 环境变量可覆盖),支持 --dry-run / --uninstall / --force
```

## 设计原则

### 渐进式披露

每个 Skill 的 SKI33.md 是快速入门（< 500 行），详细内容在 `references/` 里按需读取。Walker 不会一次读完所有材料，而是跟着 SKI33.md 的流程走，遇到需要深入了解的环节才读对应的 reference。

### 传导链追溯

```text
intent.md（为什么做）
  → research.md（业务领域）
    → project.flow.mermaid（BXX-NYY 节点编号）
      → spec.md（RXX 规则编号）
        → architecture.md（API 端点清单）
          → harness-plan.md（逐方法实现指令 + 测试断言）
            → 代码（@implements 标注节点和规则编号）
```

每条规则、每个 API 端点、每行代码都能追溯到业务意图。

### 全局约束（35 Harness）

多租户隔离、认证授权、统一错误格式、事件发布、分页、事务边界等横切关注点在 Harness 计划中作为"全局约束"段定义，所有文件统一遵守。

## 快速开始

### OpenCode

1. 运行 `./install-to-opencode.sh`，把 agents/skills 软链到 `~/.config/opencode/`
2. 在 OpenCode 中加载 `shadow-walker` agent
3. 在项目根运行 `bash skills/shadow-init/scripts/init.sh`（或 `bash ~/.config/opencode/skills/shadow-init/scripts/init.sh`）生成 `.shadow/` 骨架
4. 告诉 walker 你要做什么：*"给我做一个 XX 系统"*
5. Walker 自动走完 30→36 全流程
6. 交付物在 `.shadow/` 目录 + 项目代码中

### Claude Code

1. 运行 `./install-to-claude-code.sh`，把 agents 软链到 `~/.claude/agents/`、skills 软链到 `~/.claude/skills/`、hooks 软链到 `~/.claude/hooks/`、`settings.json` 软链到 `~/.claude/settings.json`（用户的旧 `settings.json` 会备份成 `settings.json.bak`）
2. 在项目根运行 `bash skills/shadow-init/scripts/init.sh`（或 `bash ~/.claude/skills/shadow-init/scripts/init.sh`）生成 `.shadow/` 骨架
3. 在 Claude Code 中对 Claude 说：*"使用 shadow-walker subagent 给我做一个 XX 系统"*
4. Walker 按需 `Skill` 加载工具，逐阶段推进到交付
5. 工具名按 Claude Code 规范（`Read` / `Write` / `Bash` / `Glob` / `Grep` / `Skill` / `Task` / `WebFetch` / `WebSearch`），详见 walker frontmatter 的 `tools` 字段
6. 两个安装脚本互不影响，可同时使用：OpenCode 用户用 `install-to-opencode.sh`，Claude Code 用户用 `install-to-claude-code.sh`

### pi

1. 运行 `./install-to-pi.sh`，把 agents/skills/hooks/settings.json 软链到 `~/.pi/`（默认；可设 `PI_DIR=~/.config/pi` 覆盖）
2. 在项目根运行 `bash skills/shadow-init/scripts/init.sh`（或 `bash ~/.pi/skills/shadow-init/scripts/init.sh`）生成 `.shadow/` 骨架
3. 在 pi 中说：*"使用 shadow-walker-pi subagent 给我做一个 XX 系统"*
4. pi 版 walker (`agents/shadow-walker-pi.md`) 跟 Claude Code/OpenCode 版共享核心方法论(5 类工件生命周期 / 4 问启发式 / 5 步节奏 / 变更传播表 / 回退决策树),仅 frontmatter 适配 pi 协议
5. 钩子集成跟 CC 类似,通过 `~/.pi/settings.json` 注册 4 个 hook (SessionStart/PreToolUse/PostToolUse/Stop)
6. 其他选项: `--dry-run` (只看不装) / `--uninstall` (反向卸载) / `--force` (覆盖非软链目标, 备份为 .bak)
7. 三个安装脚本互不影响,可同时使用:OpenCode + Claude Code + pi 可共存同一项目

#### 自动门禁（Hooks）

仓库根的 `settings.json` 声明了 5 个 hook，由 `install-to-claude-code.sh` 软链到 `~/.claude/settings.json`，在 CWD 位于本项目时由 Claude Code 自动加载。所有 hook 脚本在仓库根的 `hooks/`（跟 `agents/`、`skills/` 平级），**通过软链同步到 `~/.claude/hooks/`，单一源真理**：

| Hook | 触发时机 | 行为 |
|------|---------|------|
| `user-prompt-submit.sh` | UserPromptSubmit | 关键词检测"做一个 XX 系统" / "build me X" / "from scratch"等意图；命中时提示 Claude 加载 shadow-walker subagent（已有 `.shadow/` 则提醒继续走 pipeline） |
| `session-start.sh` | SessionStart | 探测项目根，输出当前 iter、status.md 阶段汇总、**BXX 业务线维度分布**、CONTEXT-MAP 摘要 |
| `pre-skill.sh` | PreToolUse (Skill) | 装任何 skill 前打印 5 步节奏提醒；若 status.md 仍有更早的 ⏳ 阶段，**硬阻断**（exit 2） |
| `post-write-stub-scan.sh` | PostToolUse (Write\|Edit) | **每次**写完代码实时扫存根（pass / TODO / NotImplementedError / InMemoryRepository），只扫刚写的文件，命中即时告警（让模型在同 turn 自纠） |
| `stop-gate.sh` | Stop | 扫源码里的存根模式（兜底，PostToolUse 已扫过的文件会重复但仍可能发现遗漏）；**按 BXX 列出** status.md 还有哪些 ⏳/🔄 阶段未完 |

工具脚本在仓库根的 `hooks/`：

```
(项目根)
  settings.json         # hook 配置（被 install 脚本软链到 ~/.claude/settings.json）
  hooks/
    lib.sh              # 共用：find_project_root / get_shadow_dir / read_bxx_breakdown / scan_stub_in_file 等
    user-prompt-submit.sh
    session-start.sh
    pre-skill.sh
    post-write-stub-scan.sh
    stop-gate.sh
```

**实时 vs 批量扫存根**：

| 维度 | `post-write-stub-scan.sh` (PostToolUse) | `stop-gate.sh` (Stop) |
|------|---------------------------------------|---------------------|
| 时机 | 每次 Write/Edit 之后 | 会话结束 |
| 范围 | 只扫刚写的文件 | 全项目 src/ |
| 反馈 | 同 turn 内告警，模型可自纠 | 一次性补刀，已晚 |
| 性能 | 轻（grep 单文件，<50ms） | 较重（grep -r 整个项目） |
| 兜底 | — | ✓（PostToolUse 漏网的全项目复扫） |

**BXX 业务线维度**：status.md 按 Walker 规范使用 `## BXX 业务线名` 分节时，session-start 和 stop-gate 自动按业务线分组输出，未完阶段按 BXX 归类显示（不会把所有 BXX 的待办混成一锅）。多业务线项目推荐遵循 Walker 的 status.md 格式：

```markdown
# Pipeline Status — iter-1

## B01 用户管理

| 阶段 | 状态 | 产出 | 自检 |
|------|------|------|------|
| 30 | ✅ | ... | — |
| 31 Research | 🔄 | ... | — |
...

## B02 订单管理

| 阶段 | 状态 | 产出 | 自检 |
|------|------|------|------|
| 30 | ✅ | ... | — |
| 31 Research | ⏳ | — | — |
...
```

**调试 hook**：

```bash
# 在项目根外（无 .shadow/）：应该输出 "No .shadow/ found"
cd /tmp && bash $HOME/.claude/hooks/session-start.sh

# 模拟 Skill 调用，看阻断逻辑
echo '{"tool_name":"Skill","tool_input":{"skill":"shadow-l6-deploy"}}' \
  | bash $HOME/.claude/hooks/pre-skill.sh
```

## 穷尽式生产场景 + R11 Round 2 (P0-X, 2026-06-07 启用)

> 解决"测试通过 ≠ 真实可用" gap: 单元/集成测试可全过, 但用户拿浏览器点登录都登录不了. R11 Round 2 把 L2 验收跟 L6 部署闭合到"真实生产行为", 跑不通就硬阻断.

### 8 维穷举矩阵 (L2 必填)

L2 walker 必须为每个 BXX 在 `production-scenarios/` 下生成 Playwright spec 套件, 8 维强制覆盖:

| 维度 | 数据来源 | L 规模最低 |
|------|---------|-----------|
| 1. Rules (RXX) | spec.md | P0 100%, P1 ≥ 80% |
| 2. Pages (data-page) | wire.svg | 100% 出现 |
| 3. Interactions (data-action) | wire.svg | P0 路径 100% |
| 4. Roles | research.md 画像 + L2 6 维发散 | 每个 core role ≥ 1 spec |
| 5. Data scale | intent.md 性能 | ≥ 100 records + ≥ 50MB 资产 |
| 6. Cross-service | architecture.md + event-contract | ≥ 2 services, ≥ 1 cross-BXX |
| 7. Error states | L3 failure-modes.md P0 | 每个 P0 1 spec |
| 8. Chaos | L3 chaos-scenarios.md @chaos P0 | 每个 P0 1 spec |

### 跟生产一致契约 (prod.config.json)

```json
{
  "version": "1.0.0", "scale": "L", "project_type": "fullstack",
  "production_contract": {
    "real_accounts": { "required": true, "source": "env:E2E_USER_*" },
    "data_scale": { "min_records": 100, "min_asset_size_mb": 50 },
    "cross_service": { "min_services": 2, "min_cross_bxx_paths": 1 },
    "no_mocks_in_p0": { "forbidden_patterns": ["InMemoryRepository", "MockDB", "fake-login"] }
  }
}
```

### L6 Phase 5.8 自动跑

```bash
bash skills/shadow-l6-deploy/scripts/run-production-scenarios.sh {slug}
# 跑通写 .shadow/iterations/iter-N/L6-deploy/{slug}/smoke-test-passed
# evidence 落 .shadow/iterations/iter-N/L6-deploy/{slug}/prod-evidence/ (chmod 444)
```

### R11 Round 2 4 层验证 (新项目硬阻断)

| 层 | 验证 | 失败处置 |
|----|------|----------|
| L1 | marker 存在 + mtime < 7 天 | FAIL (stale) |
| L2 | marker 首行正则 `production-scenarios @production: [0-9]+ passed` | FAIL (旧 marker) |
| L3 | `prod-evidence/summary.json.failed == 0` + `playwright.log` 末行 passed | FAIL (测试失败) |
| L4 | marker hash == `prod-evidence/prod-config-hash.txt` (sha256) | FAIL (marker 复用) |

### 零迁移策略 (老项目豁免)

| 项目类型 | R11 行为 |
|---------|---------|
| 新项目 (`.shadow/LIFECYCLE.md` 存在) | **4 层验证, 任一失败 → exit 1 硬阻断** |
| 老项目 (`.shadow/LIFECYCLE.md` 缺席) | Round 1 advisory (软警告, exit 0, 行为不变) |

新项目暂不启用: 在 `.shadow/scale.md` 设 `gate_options.production_scenarios: off` (off / warn / hard, 默认 hard).

### 详细文档

- L2 设计: `skills/shadow-l2-e2e/templates/production-scenarios.md` (Walker 模板)
- L2 契约: `skills/shadow-l2-e2e/references/production-scenario-contract.md` (8 维穷举 / 跟生产一致 / 退出码契约)
- L6 部署: `skills/shadow-l6-deploy/SKILL.md` Phase 5.8 段 + `references/phase-detail-7-9.md`
- R11 门禁: `skills/shadow-artifact-lifecycle/scripts/gate-check-lifecycle.sh:307-412` (替换原 R11 段) + CLAUDE.md §9
- Schema 登记: `skills/shadow-init/templates/shadow-schema.json` (production-scenarios-config + production-scenarios-evidence)
- 烟雾测试: `skills/smoke-r11-round2.sh` (16 项断言, 验证老/新项目分叉)



demo目录是采用工作流开发的demo项目