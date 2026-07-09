# Goals — iter-1

> 本 iter 要达成的高层目标。plan task(T 编号)回指这里的 G。

| G | 目标 | 状态 | 来源 |
|---|------|------|------|
| G1 | 节点定义忠实 8 个 skill 的真实产出路径(修旧版 7/8 错路径) | ⏳ | design S2 |
| G2 | 每节点 prompt 注入完整上下文(入口/上游指针/BXX/iter/自检符号) | ⏳ | design S3 |
| G3 | 验收闸认双符号(`□` 和 `- [ ]`),通过条件正确 | ⏳ | design S4 |
| G4 | 验收循环走 `init --iter N+1` 迁移,不再乱落 `loop_main_N/` | ⏳ | design S5 |
| G5 | CLI 能按序跑完八节点,产出落对位置 | ⏳ | intent 成功标准 1 |
| G6 | Web 起 server,画布编辑节点/边,SSE 实时回显状态+日志 | ⏳ | intent 成功标准 2 |
| G7 | 多业务线(B01-cli/B02-web)节点定义分组 + 跨业务线一致 | ⏳ | design S6 |
| G8 | iter 号从 current-iteration 读,不硬编码 1 | ⏳ | design S2/S5 |
