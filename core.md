 保持对通用coding 平台的支持，不要特意开发针对性的代码。 skill + agent 是所有ai coding都支持的。 xdd是啥呢， 就是 用户prompt -> 设计 -> 代码实现，
  通过中间的设计层，锚定代码开发不会偏离用户


模块化编程,先把要做的东西分成多个模块。开发并测试好模块。再对模块间模块间调通接口。


# XDD 
按照流程常备角色
角色兼容skill，以skill方式使用， 只会使用use skill do xxx 工作

角色skill:
角色中通过context pack传递消息
research -> add + bdd = arch

通用skill：
pack context: 打包上下文，在各个agent 间流转，包括， 输入文件， 输出文件， 目标，打包成json file，存储到本地文件系统，skill 包含load 和 dump

sider tool / hook tool：
sider tool 是执行的过程中，额外做一些数据保存之类的工作，提交给context，并且执行完从context移除
hook tool 是执行过程中，通过hook自行添加到 context 中的东西


## 架构模式

10 大经典架构模式(分层 / 客户端-服务器 / 主-从 / 管道-过滤器 / 代理 / 对等 / 事件总线 / MVC / 黑板 / 解释器)+ 5 个现代扩展(微服务 / CQRS / 事件溯源 / 六边形 / Space-based)的决策库,含「按质量属性场景选模式」决策矩阵:

→ `skills/xdd-architecture/references/architecture-patterns.md`

选模式不再默认套 4 层分层。原始参考(知乎「软件架构模式」系列,节选标题):
1. 分层模式 / Layered
2. 客户端/服务器模式 / Client-Server
3. 主/从模式 / Primary-Replica (旧称 Master-Slave)
4. 管道/过滤器模式 / Pipe-Filter
5. 代理模式 / Broker
6. 对等模式 / Peer-to-Peer
7. 事件总线模式 / Event-Bus
8. 模型/视图/控制器 (MVC) 模式 / Model-View-Controller
9. 黑板模式 / Blackboard
10. 解释器模式 / Interpreter