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