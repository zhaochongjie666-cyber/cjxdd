# Gate Semantics

## PASS

具备可验证证据，且正向链路无断层。

- L1.5：L1 全部规则 ID 进入 architecture.md 和 file-list.md
- L5：file-list 中承接实现文件 100% 在 harness-plan.md 中
- L5：L1 全部规则 ID 在真实代码中解析到 `@implements`
- L6：有运行态证据（启动/健康检查/接口访问/E2E）

## WARN

有契约或文档证据，但缺少运行态或外部依赖证据。

- L6 已部署但 E2E 未执行 → WARN
- L5 有 `@implements` 但缺少异常路径追溯 → WARN
- 文件在 harness-plan.md 但未实现 → WARN（正常中间态）

## BLOCKED

上游规则无法正向传导到下游，或下游证据缺失。

- L1 规则 ID 未进入 L1.5 → BLOCKED
- 承接实现文件不在 harness-plan.md 中 → BLOCKED
- L1 规则 ID 未在真实代码中找到 `@implements` → BLOCKED

## Forbidden PASS

以下内容不得标 PASS：

- `contract-only`
- `reverse-regenerated`
- `本次未启动服务`
- `未执行`
- `not executed`

## 审计结论语义

| 结论 | 含义 | 后续动作 |
|------|------|---------|
| PASS | 证据充分，可信赖 | 进入下一层 |
| WARN | 有缺口但不阻塞 | 记录缺口清单，可进入下一层 |
| BLOCKED | 关键缺失 | 必须补全后才能继续 |
