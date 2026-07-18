---
description: Cleanup and polish with adversarial verification
---

针对当前变更运行 cleanup：
- xdd-reviewer 攻击复杂度、死代码、无用抽象；
- xdd-reviewer 攻击测试缺口和兜底遗漏；
- 如需修改，仅交给一个 xdd-worker 做最小修复。

完成后再运行 focused validation。

$@
