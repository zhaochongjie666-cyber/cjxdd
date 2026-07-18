---
description: Run parallel xdd reviewers for correctness, tests, and fallback gaps
---

启动并行审查：
- xdd-reviewer：正确性/回归；
- xdd-reviewer：测试/验证证据；
- xdd-reviewer：兜底/异常/权限/降级路径。

父会话负责综合结果，不盲目应用建议。若发现未批准的产品/架构决策，暂停并请求用户确认。

$@
