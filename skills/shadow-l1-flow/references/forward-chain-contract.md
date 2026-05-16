# Forward Chain Contract

## Rule Identity

规则 ID 格式：

`<business-slug>-RNN`

例如：

`user-registration-R01`

## Required Transmission

| 上游 | 下游 | 必须出现 | 验证方式 |
|---|---|---|---|
| L1 spec.md | L1.5 architecture.md | L1 Rule Transmission Matrix | 逐条检查规则 ID |
| L1 spec.md | L1.5 file-list.md | L1 Rule To File Mapping | 逐条检查规则 ID |
| L1 spec.md | L2 e2e.md | @covers | 场景覆盖检查 |
| L1.5 file-list.md | L5 harness-plan.md | @implements + 文件路径对应 | 承接实现文件必须在 harness-plan.md 中 |
| L2 e2e.md | L5 harness 测试断言 | @covers | 测试场景覆盖 |
| L5 harness-plan.md | L5 real code | @implements | 真实代码追溯 |
| L5 + L2 | L6 deployment-report.md | 启动/健康检查/E2E 运行证据 | 运行态验证 |

## Hard Fail

- 任一 L1 规则 ID 未进入 L1.5 → L1.5 Gate FAIL
- 任一承接实现文件（file-list 中"是否承接实现=yes"）不在 harness-plan.md 中 → L5 Plan FAIL
- 任一 L1 规则 ID 未进入真实代码（`@implements`） → L5 Gate FAIL
- L6 只有 contract-only → L6 Gate WARN/BLOCKED，不得 PASS

## file-list 字段规范

file-list.md 必须区分"承接实现文件"和"验证证据文件"：

| 文件 | 类型 | 是否承接实现 | 对应 L1 规则 | 验证/备注 |
|---|---|---:|---|---|
| `backend/app/routers/xxx.py` | api | yes | xxx-R01, xxx-R04 | router entry |
| `backend/tests/test_xxx.py` | tests | no | xxx-R01, xxx-R08 | verification evidence |

- **是否承接实现 = yes** → 必须有对应 harness-plan.md 指令
- **是否承接实现 = no** → 不要求 Harness 指令，但必须作为验证证据进入 L6
