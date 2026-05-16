# UFW 协调器介入协议 — Shadow Team

> **目标：** 解决 Worker 自我审查的局限性，通过协调器抽检和强制干预确保 UFW 质量。

## 核心问题

Worker 自我执行 UFW 存在以下风险：
1. **自我偏见** — 难以发现自己产出的明显问题
2. **虚假完成** — 声称完成 UFW 但实际 .chkpt 文件为空或质量低
3. **视角单一** — 缺少独立第三方的质疑

## 协调器介入策略

### 介入时机

```
Worker UFW R1 完成 → 协调器抽检（30%概率）
Worker UFW R3 完成 → 协调器抽检（50%概率）
Worker UFW R5 完成 → 协调器必检（100%概率）
```

**触发协调器介入的其他情况：**
- R1.chkpt 的 `issues_found` < min_issues 的 50%
- R3.chkpt 的 `issues_found` = 0
- 连续两次 UFW 后 Gate FAIL

### 介入方式

#### 方式一：抽检 Review（默认）

协调器独立读取 Worker 产出 + .chkpt 文件，提出额外质疑：

```
协调器抽检发现的问题 > Worker R1 发现的问题 × 0.5
  → Worker UFW FAIL
  → 要求 Worker 从 R1 重新执行 UFW
```

#### 方式二：强制干预（严重情况）

```
连续两次抽检发现问题数量 > Worker 发现 × 2
  → 标记 Worker UFW 不可靠
  → 后续该 Worker 的所有 UFW 轮次都必须经过协调器 Review
  → 记录到 .shadow/.team/worker_ufw_status.json
```

#### 方式三：并行审查（关键任务）

```
任务标记为 critical（用户指定或 slug 含 "payment" / "auth" / "security"）
  → R1, R3, R5 均触发协调器并行审查
  → Worker 和协调器同时独立审查
  → 取并集作为质疑清单
```

## UFW 抽检 Checklist

协调器执行抽检时，按以下 Checklist 审查：

### 抽检 Step 1: .chkpt 文件完整性

```bash
# 检查文件存在
ls .shadow/.ufw/<layer>_<slug>_R{1,2,3,4,5}.chkpt

# 检查 JSON 格式有效
python3 -c "import json; json.load(open('.chkpt'))" || echo "INVALID JSON"

# 检查必填字段
grep -q '"round":' .chkpt && grep -q '"issues_found":' .chkpt || echo "MISSING FIELDS"
```

### 抽检 Step 2: 质疑清单质量审查

协调器独立审查产出文件，对比 Worker 的质疑清单：

```
协调器审查角度（与 Worker 不同）：
1. **下游依赖视角** — 下游层（如 L3）拿到这个产出能工作吗？
2. **实现成本视角** — 这个设计实现起来有什么坑？
3. **用户验收视角** — 最终用户能按这个验收吗？
4. **安全视角** — 有什么安全隐患？
```

### 抽检 Step 3: 差异分析

计算协调器 vs Worker 的差异指标：

```python
# 伪代码
def ufw_coverage_score(worker_issues, master_issues):
    """
    计算 Worker 发现率
    - 精确匹配：文件路径 + 行号 + 问题描述
    - 模糊匹配：同一文件章节
    """
    exact_matches = 0
    fuzzy_matches = 0

    for master_issue in master_issues:
        for worker_issue in worker_issues:
            if is_exact_match(master_issue, worker_issue):
                exact_matches += 1
                break
            elif is_same_section(master_issue, worker_issue):
                fuzzy_matches += 1
                break

    coverage = (exact_matches * 1.0 + fuzzy_matches * 0.5) / len(master_issues)
    return coverage

# 判定标准
if coverage < 0.5:  # Worker 发现率 < 50%
    return "UFW_INSUFFICIENT"
elif coverage < 0.3:  # Worker 发现率 < 30%
    return "UFW_CRITICAL_FAIL"
```

## 抽检结果处置

### 结果 A: Worker UFW PASS（抽检通过）

```
协调器发现问题数量 <= Worker 发现 × 0.5
  → 继续 Worker UFW 下一轮
  → 更新 .shadow/.team/ufw_audit.log
```

### 结果 B: Worker UFW WARN（轻度不足）

```
协调器发现问题数量 > Worker 发现 × 0.5 但 <= Worker 发现
  → Worker 当前 UFW 轮次标记为 "reviewed"
  → 附加协调器发现的问题到 .chkpt
  → 继续下一轮，但 R+1 轮抽检概率 +20%
```

### 结果 C: Worker UFW FAIL（严重不足）

```
协调器发现问题数量 > Worker 发现 × 1.0
  → 当前 UFW 轮次作废
  → Worker 从 R1 重新开始 UFW
  → 该 Worker 后续 UFW 强制介入
```

### 结果 D: Worker UFW CRITICAL（虚假完成）

```
Worker .chkpt 显示完成，但协调器发现关键问题（如安全漏洞、核心逻辑错误）
  → 当前 UFW 全部作废
  → Worker 重新生成该层产出
  → 记录 Worker 信用降级
```

## Worker UFW 信用评分

```json
{
  "worker_id": "w1",
  "ufw_credit": {
    "score": 85,        // 0-100，初始 100
    "level": "trusted", // trusted | standard | supervised | restricted
    "history": [
      {"date": "...", "task": "auth/L1", "coverage": 0.75, "result": "PASS"},
      {"date": "...", "task": "payment/L3", "coverage": 0.45, "result": "WARN"},
      {"date": "...", "task": "data/L2", "coverage": 0.20, "result": "FAIL"}
    ]
  }
}
```

### 信用等级与抽检策略

| 等级 | 分数 | R1 抽检率 | R3 抽检率 | R5 必检 |
|-----|------|-----------|-----------|---------|
| trusted | 90-100 | 10% | 30% | ✓ |
| standard | 70-89 | 30% | 50% | ✓ |
| supervised | 50-69 | 70% | 90% | ✓ |
| restricted | < 50 | 100% | 100% | ✓ |

### 信用分计算

```
基础分: 100
每次 UFW FAIL: -15
每次 UFW WARN: -5
每次 UFW PASS: +2（最高 +10 到基础分）
连续 3 次 PASS: 额外 +5

等级变化阈值:
  standard → trusted: 连续 5 次 PASS 且平均 coverage > 0.7
  supervised → standard: 连续 3 次 PASS 且平均 coverage > 0.6
  restricted → supervised: 连续 2 次 PASS
```

## 抽检触发时机

### 调度循环中的抽检点

```
调度循环 WHILE:
  1. 扫描 Worker 状态
  2. FOR EACH busy worker:
     IF worker 刚完成 UFW R1/R3/R5:
       → 根据抽检概率决定是否抽检
       → 如需抽检：标记 worker 为 "under_review"（不释放）
  3. 执行抽检（协调器串行）
  4. IF 抽检结果 = PASS:
       → 标记 worker 为 idle（释放）
     ELSE:
       → 发送修正 prompt（重新开始 UFW）
       → worker 保持 busy
  5. 分配新任务给空闲 Worker
```

### 抽检与正常 Review 的关系

```
Worker 声称完成某层 → UFW R1→R5 → 协调器抽检 → Gate → 协调器 Review

关键区别：
- 协调器抽检：在 UFW 过程中，检查 Worker 自我审查的质量
- 协调器 Review：在 Gate 之后，检查最终产出是否符合要求

抽检 FAIL → Worker 重做 UFW → Gate
Gate FAIL → Worker 修正产出 → 重新 Gate
```

## 实现命令

### 抽检命令

> **注意**：`shadow-team.sh` 脚本尚未实现。以下命令为预留接口，当前可通过人工 Review 或自定义脚本实现相同功能。

```bash
# 手动触发抽检（调试）— 预留接口
# scripts/shadow-team.sh ufw-audit <worker_id> <layer> <slug>

# 自动抽检（调度循环内调用）— 预留接口
# scripts/shadow-team.sh ufw-checkpoint <worker_id> <layer> <slug> <round>

# 查看 Worker UFW 信用 — 预留接口
# scripts/shadow-team.sh ufw-credit <worker_id>
```

## 质量指标追踪

建议记录的 UFW 质量指标：

```
# 按 Worker
- UFW 完成率（实际完成 UFW 轮数 / 要求轮数）
- 抽检通过率
- 平均质疑清单覆盖率
- Gate 失败后追溯的 UFW 问题占比

# 按项目
- 平均 UFW 轮次耗时
- UFW 后 Gate 一次通过率
- 有无 UFW 的 Gate 失败率对比
```

## 总结

**协调器介入 UFW 的核心价值：**
1. 防止 Worker "自我审查疲劳" 导致的质量问题
2. 提供独立第三方视角，发现 Worker 视角盲区
3. 通过信用机制差异化抽检，减少不必要的 overhead
4. 关键任务（payment/auth）强制并行审查，提升安全性

**代价：**
- 抽检增加协调器工作量（可通过信用机制调节）
- 抽检 FAIL 增加 Worker 重试次数
- 需要额外存储 .chkpt 和审计日志
