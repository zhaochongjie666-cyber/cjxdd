# L3 Resilience — Runtime Dependencies

> shadow-l3-resilience 运行时是否依赖外部工具 / 包 / 系统调用？

## 结论: **无强依赖**

L3 skill 的 SKILL.md + templates + references 是**纯文档/方法论**输出，不需要任何外部运行时。

## 弱依赖（可选，提升产出质量）

L3 软门禁脚本 `scripts/gate-check-l3.sh` 在跑时需要：

| 工具 | 用途 | 是否必需 |
|------|------|---------|
| `bash` | 跑 gate 脚本 | ✅ 必需 (任何 Unix 系统) |
| `wc` | 统计行数 | ✅ 必需 (coreutils) |
| `grep` | 匹配 @chaos / 失败 ID | ✅ 必需 |
| `jq` | 读 .shadow/shadow-schema.json | ✅ 必需 (hooks 链依赖) |
| `tc` (iproute2) | 网络延迟/丢包注入 | ❌ 可选 (L6 灾难演练用) |
| `iptables` | 网络分区注入 | ❌ 可选 (L6 灾难演练用) |
| `docker` | 容器注入 | ❌ 可选 (L6 灾难演练用) |

**结论**: L3 skill 自身**只依赖 bash + coreutils + grep**（任何 Unix 系统都有）。
下游 L5/L6 真实注入依赖 iptables/tc/docker（这些是 L6 灾难演练的依赖，不是 L3 本身的依赖）。

## 跨 skill 依赖

L3 不依赖其他 Shadow skill 的运行时，只消费它们的**产出文档**：

| 消费 | 来源 |
|------|------|
| L1.5 architecture.md | shadow-l1p5-architecture |
| L1.5 event-contract.md | shadow-l1p5-architecture |
| L1.5 aggregate-landscape.md | shadow-l1p5-architecture |
| L2 e2e.md | shadow-l2-e2e |
| L1 research.md | shadow-l1-research |

## Python 依赖（参考实现）

`references/failsafe-patterns.md` 提供了 10 个兜底模式的 Python 实现骨架（仅作参考，不是强制）：

| 包 | 用途 |
|----|------|
| `asyncio` | 异步原语（标准库） |
| `redis` | 限流 / 幂等键（可选） |
| `psycopg2` | DB 健康检查（可选） |

实际项目用什么语言/框架由 L1.5 决定，L3 不强制。

## 安装

无。L3 是文档型 skill, 直接用 `git clone` 或 symlink 到 `~/.claude/skills/` 即可。

## 卸载

```bash
rm ~/.claude/skills/shadow-l3-resilience
# 或
rm ~/.config/opencode/skills/shadow-l3-resilience
```

不影响其他 skill。
