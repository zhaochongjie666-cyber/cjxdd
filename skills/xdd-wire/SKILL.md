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

## Loop-Until-Pass: 12 门禁 + 4 层 UX 审查回环

**12 门禁只覆盖技术层 (em-dash/data-page/viewBox 等), 不覆盖 UX 层**. 加 `xdd-ux-design` 4 层审查 (L1 功能性 / L2 可用性 / L3 a11y / L4 质感) 形成**双闸门回环**.

```bash
# 写完 SVG 后, 进入回环
while true; do
    # 闸门 1: 12 门禁 (技术层)
    bash hooks/xdd-gate-wire-validate.sh
    wire_rc=$?

    # 闸门 2: 4 层 UX 审查 (设计层)
    bash hooks/xdd-gate-ux-check.sh
    ux_rc=$?

    # 全过 (0+0) 才出 loop
    if [[ $wire_rc -eq 0 && $ux_rc -eq 0 ]]; then
        echo "[xdd] ✓ 双闸门全过 (12 门禁 + 4 层 UX)"
        break
    fi

    # 修 SVG
    echo "[xdd] 修 SVG: wire_rc=$wire_rc, ux_rc=$ux_rc"
    # 改完再跑 (loop)
done
```

| 闸门 | 失败退出码 | 失败维度 | 修法 |
|------|----------|---------|------|
| **xdd-gate-wire-validate** | 2 | 12 门禁 (技术) | 改 SVG 标签 / data-page / 字体 / viewBox |
| **xdd-gate-ux-check** | 1 (L1 硬) / 2 (L2-L4 软) | 4 层 UX (设计) | 改 SVG 元素 / 加 aria / 改文案 / 加 hover |

**L1 硬阻断 (CTA / 错误反馈 / 状态可见 / 防破坏 / 键盘可达) 任一失败 → exit 1, 必须修**.

### 4 层 UX 审查 (合并 xdd-ux-design 自动卡)

| 层 | 主题 | 项数 | 失败信号 | 修法 |
|---|------|------|---------|------|
| 🔴 **L1** | 功能性 | 5 | CTA 不显 / 无错误反馈 / 状态不可见 / 删无确认 / 键盘不可达 | 加 fill, .error, loading/success/error, confirm, tabindex |
| 🟡 **L2** | 可用性 | 6 | 无统一 .btn / 无大字 / 元素 > 80 / 缺移动 / 长 text | 统一 class, h1, 分组, mobile SVG, 拆段 |
| 🟢 **L3** | a11y | 6 | 无 aria / 无对比度 / 无 :focus / 表单无 label | 加 aria-label, #fff/#000 配对, outline, label for |
| 🔵 **L4** | 质感 | 3 | 无 :hover / 无空状态 | 加 transition, empty 引导 |

**L1 任一失败 = 硬阻断 (exit 1)**. L2-L4 软警告 (exit 2 但不阻断, 建议修).

### 完整 Phase 2 出口

**只有 12 门禁 + 4 层 UX 审查双闸门全过, 才标记 Phase 2 DESIGN ✅**. orchestrator 看到任一 exit ≠ 0, 派 phase-designer 修, 3 试未过 HALT.

## workflow
设计svg()
# 写完跑双闸门, 任一失败重做 (loop until pass, 见上段)
bash hooks/xdd-gate-wire-validate.sh && bash hooks/xdd-gate-ux-check.sh
# 必须 0 + 0 才进实现阶段

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

