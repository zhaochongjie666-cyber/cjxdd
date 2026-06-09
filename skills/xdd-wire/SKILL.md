---
name: xdd-wire
description: xdd-wire，高质量前端的设计图师：svg wireframe。 一般的前端开发流程： xdd-wire -> xdd-plan -> xdd-execute
---

# xdd-wire
通过先svg设计好(`./.xdd/wire`)，然后再进行前端实现关注页面设计

## def 设计svg
1. 读取 `.xdd/bdd/` 中的 Feature/Scenario，提取页面

## def 实现前端
1. 根据设计的 svg，使用前端技术栈实现页面
2. 每个页面组件都要有对应的测试用例，确保实现符合设计

## Pre-flight 12 门禁 (写完 SVG 必跑, 写不进 status.md 也会被 hook 拦)

**session c3692b46 教训**: walker 自评"wire 设计完成"实则 12 门禁 11 失败. 这次硬约束:

```bash
# 写完 wire SVG 后必跑 (Phase 2 出口闸门)
bash hooks/xdd-gate-wire-validate.sh
# 退出码 0 = 12/12 全过, 2 = 至少 1 门禁失败 (exit 2 触发 orchestrator 修)
```

| # | 门禁 | 阈值 | 速查 |
|---|------|------|------|
| 1 | em-dash 字符 | 0 命中 (—) | `grep -c "—" wire/*.svg` |
| 2 | data-page 标注 | ≥ 8 个组件 | `grep -cE 'data-page' wire/*.svg` |
| 3 | data-state 标注 | ≥ 4 个状态 | `grep -cE 'data-state' wire/*.svg` |
| 4 | accent color | 4 种 (blue/red/green/yellow) | 检查 4 种 hex 都有 |
| 5 | 字体 | system-ui sans-serif | CSS 含 `system-ui` |
| 6 | mobile SVG | 1 份 ≤ 375px 宽 | viewBox / width 检查 |
| 7 | desktop SVG | 1 份 ≥ 1024px 宽 | 同上 |
| 8 | viewBox | 必有 | `grep -c viewBox` |
| 9 | aria-label | 所有交互元素 | `grep aria-label` |
| 10 | 焦点态 | :focus 样式可见 | CSS 含 `:focus` |
| 11 | 错误态 | .error 状态明确 | class 含 error |
| 12 | loading 态 | .loading 状态明确 | class 含 loading |

**写完即跑, 不要攒到 Phase 末尾**. 一旦 12 门禁过, 才标记 Phase 2 DESIGN ✅.

## workflow
设计svg()
# 写完跑 12 门禁, 失败重做 (不要进实现阶段)
bash hooks/xdd-gate-wire-validate.sh  # 必须 0 退出

do 实现前端()
  # 跑 Playwright CLI 截图验证 — 默认 headed 模式 (有头), 方便观察测试过程
  # 例: `playwright open --browser=chromium http://localhost:3000/login`
  #     `playwright screenshot --browser=chromium http://localhost:3000/login /tmp/login.png`
  # CI / 服务器环境无显示器时, 加 --no-headed 切到 headless
  then playwright cli 截图 (headed 模式, 方便观察)
  if 相同
    then break
  else
    if svg 有误
      then go to 设计svg()
    else
      then 继续调整实现，直到截图与 svg 相同

