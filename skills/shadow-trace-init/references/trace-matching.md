# Trace Matching 策略

## @implements 推断策略（按优先级）

| 策略 | 方法 | 准确率 | 适用场景 |
|------|------|:------:|----------|
| 文件名匹配 | harness-plan.md 含 API/组件名 → 匹配 spec 中同关键词规则 | ~70% | 文件命名规范的项目 |
| 内容语义匹配 | harness-plan 描述关键词与 spec 规则描述比对 | ~80% | 有详细注释的项目 |
| L1.5 file-list 映射 | 从 L1.5 file-list.md 中获取规则→文件映射 | ~90% | L1.5 已完成的项目 |

## 匹配流程

1. 读取 L1 spec 中所有规则 ID（grep `-R\d+`）
2. 对每条规则提取关键词（API路径、组件名、操作类型）
3. 按优先级策略扫描候选文件
4. 多策略交叉验证：
   - 一致 → 自动写入 @implements
   - 不一致 → 标记需人工确认
5. 输出推断结果，请求用户确认

## 推断结果示例

```
规则 R01 → 推断文件: auth.py, auth_service.py
  策略1(文件名): auth → auth.py ✅
  策略2(内容): "用户登录" → auth_service.py.login() ✅
  策略3(L1.5): file-list.md → auth_service.py ✅
  结论: HIGH 置信度 → auth_service.py @implements: slug-R01
  
规则 R05 → 推断文件: mail.py
  策略1: mail → mail.py ⚠️ (名称匹配但无测试)
  策略2: "发送邮件" → mail_service.py.send() ⚠️ (未找到直接调用)
  结论: MEDIUM 置信度 → 需人工确认
```

## 置信度标注

| 等级 | 标记 | 来源 |
|:----:|:----:|------|
| HIGH | ✅ | 多策略一致 + 有测试覆盖 |
| MEDIUM | ⚠️ | 单策略匹配或有冲突 |
| LOW | ❓ | 无直接证据，行业惯例推测 |
