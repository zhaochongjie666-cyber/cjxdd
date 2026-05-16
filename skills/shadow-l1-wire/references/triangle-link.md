# Triangle Link

L1 wire 层使用与 flow/spec 相同的三角链接约束：

- 每个 `data-node="BXX-NYY"` 必须能在 `project.flow.mermaid` 中找到对应节点
- spec 中涉及 UI 的规则必须能映射到至少一个 wire 节点
- Gate 从 `wire.svg` 提取 `data-node`

详细规范以 `skills/shadow-l1-flow/references/triangle-link.md` 为准。
