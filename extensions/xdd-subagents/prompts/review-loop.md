---
description: xdd 正向/兜底 review loop
---

先让 xdd-reviewer 攻击当前 diff/产物；若发现缺口，交给 xdd-worker 按 reviewer 证据修复；再重复 reviewer。最多 3 轮，除非用户另有指定。停止条件：正向证据与兜底攻击证据均闭环，或出现未批准决策需要用户介入。
