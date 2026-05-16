# T13: RBAC 权限模型模板

## 适用场景

- 角色、权限、菜单管理
- 数据权限（行级、列级）
- 权限校验、动态菜单

## 泳道设计（W3H）

| 泳道 | Who | What | Why | How |
|------|-----|------|-----|-----|
| B01 角色管理 | Admin | 角色 CRUD、权限分配 | 角色是权限的载体 | HTTP API |
| B02 权限校验 | System | 请求拦截、权限判断 | 确保用户只能操作授权范围内的资源 | 中间件 + 拦截器 |
| B03 数据权限 | System | 行级/列级过滤 | 不同用户只能看到自己权限范围内的数据 | 查询拦截 |

## 入口分析（W3H）

| 入口 | Who | What | Why | How |
|------|-----|------|-----|-----|
| 管理员配置 | Admin | 角色/权限 CRUD | 管理员需要定义权限体系 | `* /api/roles`, `* /api/permissions` |
| 用户请求 | User | 访问受保护资源 | 用户操作系统功能 | `* /api/*` |
| 分配角色 | Admin | 给用户分配角色 | 用户需要获得角色才有权限 | `POST /api/users/:id/roles` |

## Mermaid 图

```mermaid
flowchart TD
    ENTRY_ADMIN["👑 管理员配置权限体系<br/>trigger: admin<br/>entry: * /api/roles, /api/permissions<br/>role: Admin"]
    ENTRY_REQUEST["👤 用户访问受保护资源<br/>trigger: user<br/>entry: * /api/*<br/>role: Any authenticated"]
    ENTRY_ASSIGN["👑 管理员分配角色<br/>trigger: admin<br/>entry: POST /api/users/:id/roles<br/>role: Admin"]

    subgraph B01["⚙️ B01 角色管理"]
        %% Why: 角色是权限的载体，需要正确配置
        direction TB
        B01-N01["创建角色(定义权限集合)<br/>POST /api/roles<br/>write: role<br/>role: Admin"]
        B01-N02["定义权限(绑定资源+操作)<br/>POST /api/permissions<br/>write: permission<br/>role: Admin"]
        B01-N03["角色绑定权限(授权)<br/>POST /api/roles/:id/permissions<br/>write: role_permission<br/>role: Admin"]
        B01-N04["用户绑定角色(赋予身份)<br/>POST /api/users/:id/roles<br/>write: user_role<br/>role: Admin"]
        B01-N05{"角色是否可分配(层级校验)<br/>condition: target_role.level <= admin.role.level"} 
        B01-N06["缓存用户权限(加速校验)<br/>cache: user_permissions<br/>role: System"]
    end

    subgraph B02["🔒 B02 权限校验"]
        %% Why: 确保用户只能操作授权范围内的资源
        direction TB
        B02-N01["解析请求目标(资源+操作)<br/>read: request.route, method<br/>role: System"]
        B02-N02["加载用户权限(从缓存/DB)<br/>read: user_role, role_permission<br/>cache: user_permissions<br/>role: System"]
        B02-N03{"是否有功能权限<br/>condition: required_permission in user_permissions"}
        B02-N04["放行请求<br/>role: System"]
        B02-N05["拒绝访问<br/>返回 403: 无{resource}的{action}权限<br/>role: System"]
        B02-N06["构建动态菜单(按权限过滤)<br/>GET /api/menus<br/>read: menu, user_permissions<br/>role: System"]
    end

    subgraph B03["📊 B03 数据权限"]
        %% Why: 不同用户只能看到权限范围内的数据
        direction TB
        B03-N01{"数据权限类型<br/>condition: permission scope type"}
        B03-N02["全局数据(无过滤)<br/>role: Admin<br/>role: System"]
        B03-N03["部门数据(部门过滤)<br/>condition: data.owner_dept = user.dept<br/>role: System"]
        B03-N04["个人数据(仅自己)<br/>condition: data.owner_id = user.id<br/>role: System"]
        B03-N05["自定义数据权限(规则过滤)<br/>condition: custom rule eval<br/>role: System"]
        B03-N06["注入过滤条件到查询(透明过滤)<br/>update: query WHERE clause<br/>role: System"]
    end

    ENTRY_ADMIN --> B01-N01
    B01-N01 --> B01-N02
    B01-N02 --> B01-N03

    ENTRY_ASSIGN --> B01-N05
    B01-N05 -->|否| ERR_ROLE["resultNode: 不能分配比自己高级的角色"]
    B01-N05 -->|是| B01-N04
    B01-N04 --> B01-N06

    ENTRY_REQUEST --> B02-N01
    B02-N01 --> B02-N02
    B02-N02 --> B02-N03
    B02-N03 -->|是| B02-N04
    B02-N03 -->|否| B02-N05

    B02-N04 --> B03-N01
    B03-N01 -->|"全局"| B03-N02
    B03-N01 -->|"部门"| B03-N03
    B03-N01 -->|"个人"| B03-N04
    B03-N01 -->|"自定义"| B03-N05
    B03-N02 --> B03-N06
    B03-N03 --> B03-N06
    B03-N04 --> B03-N06
    B03-N05 --> B03-N06

    RESULT_GRANTED["resultNode: 权限校验通过"]
    RESULT_DENIED["resultNode: 403 权限不足"]

    B02-N04 --> RESULT_GRANTED
    B02-N05 --> RESULT_DENIED

    classDef triggerAdmin fill:#3B1028,stroke:#F472B6,color:#FCE7F3,stroke-width:2px
    classDef triggerUser fill:#3D2C00,stroke:#FBBF24,color:#FEF3C7,stroke-width:2px
    classDef process fill:#172033,stroke:#5AA9E6,color:#E5EDF7,stroke-width:2px
    classDef decision fill:#1A3A2D,stroke:#2E7D32,color:#E8F5E9,stroke-width:2px
    classDef error fill:#4A1D24,stroke:#FB7185,color:#FFE4E6,stroke-width:2px
    classDef resultNode fill:#173E2D,stroke:#34D399,color:#D1FAE5,stroke-width:2px

    class ENTRY_ADMIN,ENTRY_ASSIGN triggerAdmin
    class ENTRY_REQUEST triggerUser
    class B01-N01,B01-N02,B01-N03,B01-N04,B01-N06,B02-N01,B02-N02,B02-N04,B02-N05,B02-N06,B03-N02,B03-N03,B03-N04,B03-N05,B03-N06 process
    class B01-N05,B02-N03,B03-N01 decision
    class ERR_ROLE error
    class RESULT_GRANTED,RESULT_DENIED resultNode
```

## 异常路径清单

| 触发点 | 错误码 | Why | 恢复方式 |
|--------|--------|-----|---------|
| B01-N05 | 403 | 不能分配比自己高级的角色 | 返回权限不足 |
| B02-N03 | 403 | 无功能权限 | 返回具体缺失权限 |
| B03-N03 | 200 | 部门数据过滤 | 注入 WHERE 条件 |
| B03-N04 | 200 | 个人数据过滤 | 注入 owner_id 条件 |
| B01-N06 | 500 | 权限缓存失败 | 降级到 DB 查询 |

## 常见变异

| 变异点 | 默认方案 | 替代方案 |
|--------|---------|---------|
| 权限模型 | RBAC | ABAC（属性权限）/ ACL |
| 数据权限 | 行级过滤 | 列级过滤（字段可见性） |
| 角色层级 | 扁平 | 层级继承（子角色继承父角色） |
| 权限缓存 | Redis | JWT 内嵌权限 / 无缓存（实时查） |
| 多租户 | 无 | 租户隔离 + 租户级角色 |
| 动态菜单 | 服务端生成 | 前端路由守卫 |
