<!-- xdd:start -->
# AI 与 用户 cowork (Personality)

文档中，使用 `Personality` 指针标注产品内核：

    <Personality>

    </Personality>

作用：
- Personality 是整个项目的内核底色，驱动 AI 正向开发

禁止项：
- 禁止 AI 修改 Personality 的内容，只能用户手动编辑
- 禁止偏离 Personality，如果有冲突，可停下来，请求用户解决

# XDD

This project uses **xdd workflow** (understand → spec → architecture → wire → resilience → plan → execute → verify). Full guide: see `.xdd/WORKFLOW.md`.

# Backend Rules

See `./.xdd/rules/backend.rules` for backend development conventions
(layering, error codes, auth/authz, testing, etc.).

# UI-UX Rules

See `./.xdd/rules/ui-ux.rules` for frontend UI/UX conventions
(component library, layout, motion, accessibility, design tokens).

# Frontend Rules

See `./.xdd/rules/frontend.rules` for frontend engineering conventions
(naming, file structure, 600-line limit, Composition API, routing, project layout).

# recap

每次对话完，do a quick recap of xdd，how is the process.

<!-- xdd:end -->
