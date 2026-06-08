---
description: 触发 HALT 升级 — 同一 P1 连续 3 试未修, 强制回退到设计层
argument-hint: (无参数)
---

# /xdd-halt — 触发 3 试 HALT 升级

按 xdd 严苛模式 (no-advisory) 规则: 同一 P1 issue 连续 3 试未修 → 升级 HALT, 强制回退到设计层.

## 触发条件

- 同一 P1 issue 出现 3 次未修
- `.xdd/iterations/{iter}/.l5-halt.json` 已存在
- walker 仍继续埋头改代码

## 行为

1. 检测 `.l5-halt.json` 存在 → 强阻断
2. 输出 HALT 段:
   ```
   [xdd] 🛑🛑🛑 HALT — {N} 项持续 > 3 轮未修复
   [xdd]
   [xdd] 强制处置 (按优先级):
   [xdd]   1) **回退上游 design**: 这条 fail 可能是 spec 写得不合理, 改 spec/arch
   [xdd]   2) **调 scale 字段**: 改 .xdd/scale.md 把对应字段调到 L 级
   [xdd]   3) **走变更令**: 走 xdd-walker 重新协调
   [xdd]   4) **写 `bypass-shdw: <具体原因>` 注释**: 真要绕过, 必须带 reason 进 audit log
   ```
3. 等待用户介入决策
4. 不允许继续埋头改代码

## 何时用

用户发现 walker 还在继续硬撑某个修不过的 P1 时, 调 `/xdd-halt` 强制升级 HALT.

## 不要做的事

- 删 `.l5-halt.json` (那是审计证据)
- 改 stub_patterns 配 schema 躲检查
- 装作没看见继续干

## 退出码

- 0: HALT marker 存在, 升级成功
- 1: 无 HALT marker (不需升级)
- 2: 无 `.xdd/` 项目
