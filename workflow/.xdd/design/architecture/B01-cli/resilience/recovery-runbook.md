# 恢复剧本(runbook)— B01-cli

> 运维值班用:故障症状 → 立即动作 → 根因诊断树 → 恢复步骤。每步有具体命令。
> 区分自动恢复 vs 人工介入。

## 症状 1:workflow 启动即退出,报"缺需求文档"

**立即动作**(人工):
```bash
ls <task_dir>/prd.md        # 确认缺失
```
**根因**:task_dir 无 prd.md(@failure-mode-F09)。
**恢复**:
```bash
echo "# 需求内容" > <task_dir>/prd.md
python workflow/run_workflow.py -t <task_dir>   # 重跑
```

## 症状 2:报"claude 命令未找到"或启动报错

**立即动作**(人工):
```bash
which claude                # 应返回路径
claude --version            # 确认可用
```
**根因**:claude CLI 不在 PATH(@failure-mode-F01)。
**恢复**:安装 claude CLI 或修正 PATH,重跑。

## 症状 3:节点卡住超过 5 分钟无输出

**立即动作**(人工):
```bash
ps aux | grep claude        # 找 claude 子进程 PID
tail -f <task_dir>/log/claude/*.log   # 看是否真卡住
```
**根因**:claude 超时(@failure-mode-F02),或模型限流/网络慢。
**恢复**:
- 若进程还在但无输出 → `kill <pid>`,workflow 检测到非 success 后处理。
- 重跑:`python run_workflow.py -t <dir> -f`(force 忽略部分产物,或删该节点产物单跑)。
**自动**:select 心跳 3000s 自动 kill(无需人工等满)。

## 症状 4:验收循环反复,verify 一直不过

**立即动作**(人工):
```bash
cat <task_dir>/.xdd/runs/iter-N/verify-report.md   # 看未过项
cat <task_dir>/.xdd/current-iteration              # 看到第几 iter
```
**根因**:verify gate 条件无法满足(@failure-mode-F07)。
**恢复**:
- 看 verify-report.md 的未过项,判断是 skill 产出问题还是 gate 误判。
- iter 达上限会自动停止(P2 兜底)。
- 人工修 verify-report 或调整需求后,`init --iter N+1` 继续。
**自动**:iter 上限(5)自动停,不死循环。

## 症状 5:报"模型 X 无 env 配置"

**立即动作**(人工):
```bash
cat workflow/models.yaml     # 检查 env 字段
```
**根因**:models.yaml 的 env 空(@failure-mode-F04)。
**恢复**:
```bash
vim workflow/models.yaml     # 填 ANTHROPIC_API_KEY=sk-xxx
# 重跑(workflow 启动时 load_model_envs 读新配置)
```
**自动**:警告但继续(用 claude 自身环境),不崩溃。

## 症状 6:产物落错位置,下游 skill 读不到

**立即动作**(人工):
```bash
find <task_dir>/.xdd -name "*.md" | sort          # 看实际落哪
diff <实际路径> <spec/rules.md 的路径表>            # 对照
```
**根因**:build_nodes 路径不忠实 skill(@failure-mode-F06)。
**恢复**:修 build_nodes(对照 spec/B01-cli/rules.md 路径表),重跑该节点。
**自动**:verify 阶段对照 R01 检测,未过则报告。

## 回滚路径

- **iter 回滚**:iter 只前进不倒退(init 限制)。要"回滚"→ 备份当前 design/,`init --force --iter 1` 重来(会丢 status)。
- **产物回滚**:design/ 跨 iter 保留,若某 iter 改坏 design → 用 git(若 task_dir 是 git 仓库)或备份恢复。
