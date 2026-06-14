# Skill 归档（2026-06-14）

这一批 skill 在「prompt → 设计 → 代码」深度重构中被合并 / 重命名 / 废弃，归档于此。

## 合并进新 skill（方法论保留，结构重组）

| 旧 skill | 并入 | 保留什么 |
|---------|------|---------|
| `xdd-l0` | `xdd-understand` | brainstorm + 发散 + 收敛 design.md |
| `xdd-core` | `xdd-understand` | 意图是真相之源、不可擅删 |
| `xdd-gherkin-writer` | `xdd-understand`(需求侧) + `xdd-spec`(场景侧) | Given/When/Then 方法论 |
| `xdd-bdd` | `xdd-spec` | RXX 规则 + Gherkin 8 规范 |
| `xdd-arch` | `xdd-architecture` | ADD+SDD+PDD+ODD 四支柱 |
| `xdd-flow` | `xdd-architecture` | 组件分解流程图 |
| `xdd-l3` | `xdd-resilience`(rename) | RDA 8 维失败模式 + 兜底 + 混沌 |
| `xdd-ux-design` | `xdd-wire`(references/ux-review.md) | 4 级 UX 审查框架 |
| `xdd-l6` | `xdd-verify`(rename) | 禁偷懒归因 + 真实可用契约 |
| `xdd-scaffold` | `xdd-execute`(Step 0) + `xdd-verify`(smoke) | 7 步 Docker 环境 |
| `xdd-design-review` | `xdd-verify`(4 维一致性审计) | spec↔code 等 4 维审计 |
| `xdd-trace-init` | `xdd-reverse`(Step 3) | 双向追溯 + @implements |

## 废弃（闸门机器 / 非主轴）

| 旧 skill | 为什么废弃 |
|---------|-----------|
| `xdd-artifact-lifecycle` | 纯 5-role 闸门机器，依赖 schema.json gate。追溯纪律回归各 skill 的"上游/下游"段 |
| `xdd-coverage-monitor` | 运行时覆盖率，hook 耦合。覆盖率自检回归 xdd-execute / xdd-verify 文字 |
| `xdd-taste` | 品味准则，并入设计层各 skill references（如 wire/ux-review） |
| `xdd-opencode-learning` | OpenCode 源码学习工具，非 prompt→设计→代码 主轴 |
| `xdd-test-in-tmux` | tmux 测试工具，开发工具非主轴 |
| `xdd-flow-bug-report` | session 复盘，非主轴 |

## 旧 smoke 脚本（验证旧结构，失效）

- `smoke-xdd-e2e.sh` —— 验证旧 13 skill + 11 hook + baseline/ 结构，已不符新结构
- `smoke-xdd-scaffold-docker.sh` —— 验证旧 scaffold + docker 集成，scaffold 已并入 execute
- `xdd-execute/scripts/loop-until-pass.sh` —— 纯 hook 调用循环，被 no-stub-check.sh + 文字自检取代
- `xdd-init/templates/` + `iter-inherit.sh` —— 旧 schema.json / WORKFLOW.md 注入 / iter 子树，新 init 不用

新 smoke 在 Stage 6 重写（验三层骨架 + 零平台耦合 + 追溯闭环）。

需要参考旧闸门逻辑（stub-scan / L5 一致性 / R11 / FMEA schema）的实现时，可读这里的源码移植成可移植 bash 自检。
