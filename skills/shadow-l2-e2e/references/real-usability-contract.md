# Real Usability Contract — 真正可用契约

> 适用于 Agent Worker、Checker、L4/L5/L6 Gate 和所有声明“可用 / 已部署 / 已验收”的交付。

## 定义

“真正可用”不是服务能启动、接口返回 200/201、单元测试通过或页面能打开。

真正可用必须证明：真实用户路径能在运行中的系统里完成，业务数据被真实持久化，跨服务链路闭合，重启后关键数据仍可查询，且证据可复核。

## 必须满足

| 维度 | PASS 标准 | 不可接受 |
|------|-----------|----------|
| 持久化 | 业务数据写入项目声明的持久化层，如 PostgreSQL/MySQL/SQLite 文件/对象存储 | `InMemoryRepository`、进程内 dict/list、重启即丢 |
| 跨服务 | 前端/HTTP 客户端 → 后端 API → DB/存储 的真实链路可验证 | 只测 handler/service，或只 mock repository |
| 认证授权 | 真实 token/session/seed 用户可登录并触发权限校验 | 硬编码 current_user、固定 role、绕过 verify token |
| 数据一致性 | 创建的数据可查询、可被后续 API 使用，状态转换可观察 | API 返回 201 但无法查回或跨 API 使用 |
| 重启保留 | 重启服务后关键业务数据仍存在 | 只在当前进程内可见 |
| UAT 执行 | P0 UAT 按真实用户路径执行并生成截图/网络/数据证据 | 只写 UAT 剧本、只口头声明 PASS |
| 测试诚实度 | 测试报告区分 unit/integration/e2e/UAT | 用单元测试总数冒充可用性证据 |

## 证据要求

声明 `DEPLOY_PASS` 或“真正可用”时，报告必须包含：

- `real_usability: PASS`
- `persistence_proof`: 创建数据、查询数据、DB/存储证据摘要
- `restart_survival_proof`: 重启前后同一业务数据仍可查询
- `auth_proof`: 登录/鉴权/越权拒绝证据
- `cross_service_proof`: 前端或 HTTP 场景触发后端并落库的证据
- `uat_execution_proof`: UAT 剧本编号、执行方式、截图/网络/数据证据路径

## 判定规则

- HTTP 200/201 只能证明连通性，不能证明业务可用。
- `109 tests PASSED` 只能证明测试集合通过，必须说明 unit/integration/e2e/UAT 分布。
- 生产路径绑定内存仓库、假登录或 mock DB 时，L5/L6 不能 PASS。
- `DEPLOY_PARTIAL` 不能创建 L6 `.passed` 标记。
- 外部第三方服务无法真实调用时，可以使用可审计 local fake service；项目自身 DB/API/Auth 不允许 fake。
