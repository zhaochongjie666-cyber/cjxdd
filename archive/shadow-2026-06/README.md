# Shadow 体系归档 (2026-06-08)

> **本目录是 xdd 框架迁移过程中 (2026-06-08) 旧 shadow 体系的归档位置.**
> 保留期: **90 天** (到期日: **2026-09-08**).
> 到期后此目录将被 `git rm` 删除, shadow 体系正式从 xdd 框架消失.

## 背景

2026-06-08, xdd 框架迁移执行, 删除全部 shadow 资源:

- 19 个 shadow skill (shadow-init / l0 / l1-flow / l1-research / l1-spec / l1-wire / l1p5-arch / l2-e2e / l3-resilience / l5-impl / l5-plan / l5-stargate / l6-deploy / scaffold / reviewer / artifact-lifecycle 等)
- 3 个 shadow agent (shadow-walker / shadow-walker-pi / shadow-worker)
- 3 个 shadow prompt/command (ai-execution-prompt / team_loop / cjgoal)
- 2 个 shadow smoke (smoke-r11-round2 / smoke-scaffold-docker)
- 1 个 shadow doc (SHADOW-WORKFLOW.md)

## 保留原因 (90 天)

- 给老用户提供回退窗口
- 给老 demo 项目留兼容时间 (e.g. cjxdd-demo 等)
- 给 git history 留审计基线 (commit 8d0f7c5 等保留完整)

## 检索老 shadow 内容

shadow 资源在 git history 中仍然可见:

```bash
# 找最近 shadow 相关 commit
git log --oneline --all | grep -i shadow | head

# 看 5d0f7c5 (删除前的最后一个状态)
git show 5d0f7c5 -- skills/shadow-init/ | head -50

# 检出旧 shadow 状态 (临时 worktree)
git worktree add /tmp/shadow-legacy 5d0f7c5
ls /tmp/shadow-legacy/skills/shadow-*
```

## 到期处置 (2026-09-08)

```bash
# 90 天到期后跑
git rm -r archive/shadow-2026-06/
git commit -m "chore(framework): 删除 shadow 体系归档 (90 天保留期已过)"
```

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
