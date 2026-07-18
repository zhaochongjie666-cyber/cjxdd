# AGENTS.md — cjpi （xdd-flow）

xddflow is 流程driven，用于可靠地开发项目

pi： coding 工具
extensions/xdd: xdd插件工具，辅助流程
skills: xdd skill, 跟插件结合

it will ln to user scope, that support ai coding for any project
```
ln -sf $REPO_ROOT/extensions  ~/.pi/agent/extensions
ln -sf $REPO_ROOT/agents  ~/.pi/agent/agents
ln -sf $REPO_ROOT/skills  ~/.pi/agent/skills
ln -sf $REPO_ROOT/prompts  ~/.pi/agent/prompts
``` 

# Do not
do not write anything in {{current_project}}/.pi

# how to verify project works
pi --model MiniMax/MiniMax-M3 -p hi

# Project philosophy: 正向和兜底

“正向和兜底” 是 xdd-flow 的核心术语：

- **正向设计**：先把 happy path、目标能力、用户旅程、业务规则、架构端点和交互状态设计清楚。
- **兜底设计**：同时设计失败、拒绝、异常、无权限、依赖不可用、环境缺失、数据恢复、降级路径。只做正向不算完成。
- **攻击检查**：verify 不是照单确认，而是主动攻击正向和兜底：正向路径要证明真能跑通，兜底路径要证明真能拦住/恢复/降级。
- **回炉重造**：攻击发现缺口后，不要把问题包装成“环境限制/基本完成”；要回到 execute/spec/architecture/wire/resilience 等正确层修复。
- **循环到完成**：正向设计 → 攻击检查 → 回炉重造 → 再攻击检查，直到正向和兜底都有证据闭环。

任何阶段声称完成，都必须同时回答：正向是否跑通？兜底是否被攻击过？失败证据是否推动了回炉重造？
