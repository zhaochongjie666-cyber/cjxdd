---
name: xdd-plan
description: 根据 .xdd 相关文档（BDD、ADD、Flow、Wire）生成 TDD 实践计划，每个步骤包含完整代码、精确文件路径和验证命令。计划面向零上下文工程师，粒度为 2-5 分钟单动作步骤，DRY、YAGNI、TDD、频繁提交。
---

# xdd-plan — Implementation Planning Skill

## 使用场景

当用户要求基于 BDD / ADD / Flow / Wire 生成实现计划、实施计划、开发计划、任务拆解时，使用本 skill。

计划的目标是把 BDD 的验收场景、ADD 的架构战术、Flow 的组件职责和 Wire 的 UI 产出转化为工程师可直接执行的 bite-sized 任务列表。假定执行工程师技能扎实但对代码库零了解、对问题域几乎无知、测试设计能力偏弱。

计划不负责描述业务意图、架构战术或 UI 规范——这些由 BDD / ADD / Wire 分别负责。计划只负责"按什么顺序、改哪些文件、写什么代码、跑什么测试"。

## 输入对齐要求

生成计划前，优先读取以下来源：

1. `.xdd/bdd`
   - Feature / Scenario 列表
   - 验收断言（Then/And）
   - 异常路径
   - Scenario Outline + Examples

2. `.xdd/add`（如已有）
   - 状态机
   - 启动/关闭序列
   - 并发模型
   - 异常恢复策略
   - 架构战术清单

3. `project.flow.mermaid`
   - 组件名称与职责
   - 数据流向
   - 协议与 Payload
   - 外部依赖

4. `.xdd/wire`（如已有）
   - 页面列表
   - 组件与交互标注
   - 设计 Token

5. 当前代码或用户提供材料
   - 文件路径
   - 入口函数
   - 数据模型
   - 错误码 / 异常类型
   - 测试框架与已有测试

计划中出现的组件名、状态名、字段名、API 名、产物名必须与以上来源保持一致。未知内容必须标注为"待确认"，不要编造。

## 范围检查

如果 BDD / ADD 覆盖了多个独立子系统，应拆分为多份独立计划——每份计划对应一个可独立运行、可独立测试的子系统。每份计划应能产出可运行、可测试的软件。

判断是否需要拆分：

- 是否有独立的数据库表 / 存储对象？
- 是否有独立的服务入口 / API 前缀？
- 是否有独立的状态机？
- 是否可以独立部署？

以上任一为"是"时，考虑拆分为独立计划。

## 文件结构

在定义任务前，先列出所有需要创建或修改的文件及其职责。这是分解决策的锚点。

- 每个文件有且仅有一个明确的职责
- 一起变更的文件放在一起，按职责拆分而非按技术层拆分
- 优先小而聚焦的文件，避免大而全
- 在已有代码库中，遵循既有模式。如既有文件已臃肿，可在计划中包含拆分步骤

文件结构直接决定任务分解。每个任务应产出独立可理解的变更。

## 任务粒度

**一个 Task = 一个行为路径。**

按行为路径拆分，而不是按组件拆分：

- "用户密码登录成功" — 一个 Task
- "用户密码错误" — 一个 Task
- "账号被锁定" — 一个 Task
- "记住我延长 Token" — 一个 Task

**步骤数量指导：**

| Task 类型 | 步骤数 | 模式 |
|---|---|---|
| 简单 | 3 步 | 写测试 → 实现 → 提交 |
| 标准（推荐） | 5 步 | 写失败测试 → 确认失败 → 写实现 → 确认通过 → 提交 |
| 复杂 | 最多 7 步 | 多一轮 TDD 循环 + 提交 |

**超过 7 步必须拆分为多个 Task。**

**每个步骤是一个动作（2-5 分钟）：**

- "写失败测试" — 一个步骤
- "跑测试确认失败" — 一个步骤
- "写最小实现使测试通过" — 一个步骤
- "跑测试确认通过" — 一个步骤
- "提交" — 一个步骤

## 依赖关系

Task 之间必须声明依赖。无依赖的 Task 可以并行执行。

**声明方式：** 每个 Task 头部的 `Depends on` 字段。

**计划头部包含依赖关系表：**

```markdown
## 依赖关系

| Task | Depends On | 可并行 |
|---|---|---|
| Task 1 | None | 是 |
| Task 2 | None | 是 |
| Task 3 | Task 1 | 否 |
| Task 4 | Task 1, Task 2 | 否 |
```

**规则：**

- 依赖必须指向序号更小的 Task（无环）
- 所有 Task 构成 DAG
- 如果 Task B 依赖 Task A，则 Task A 中定义的类型、函数、文件 Task B 可以直接引用
- 无依赖的 Task 标记为 "None"，表示可立即开始

## BDD → Task 映射策略

### 映射规则

1. **Scenario Outline + Examples → 一个 Task**
   - Examples 中的每一行在测试中用 `@pytest.mark.parametrize` 或等价机制覆盖
   - 不拆成多个 Task

2. **单个 Scenario → 一个或多个 Task**
   - 成功路径 → 一个 Task
   - 每个 Then 断言涉及不同组件时 → 拆为多个 Task（按组件分）

3. **异常 Scenario → 独立 Task**
   - 每个异常路径（数据缺失、权限不足、重复提交等）独立一个 Task

4. **Background → 第一个相关 Task 的前置步骤**
   - Background 中描述的前置条件在第一个相关 Task 的 setup 步骤中实现

### 映射追踪

每个 Task 必须标注 BDD 来源：

```
**BDD 来源：** `login.feature :: Scenario: 密码登录成功`
```

如果 Task 对应多个 Scenario，用逗号分隔。如果是 Scenario Outline，标注 Outline 名称。

## 计划文档头部

**每份计划必须以此头部开始：**

```markdown
# [功能名称] 实现计划

> **给执行工程师：** 按顺序执行每个 Task，每个 Step 用 checkbox 标记进度。遇到"待确认"立即停下问人。

**目标：** [一句话描述构建什么]

**架构：** [2-3 句描述方案]

**技术栈：** [关键依赖与版本]

**验收来源：** [对应的 BDD Feature 文件路径]

---
```

## 任务结构

每个 Task 必须包含以下字段：

````markdown
### Task N: [行为路径名称]

**Depends on:** Task X, Task Y（无依赖写 "None"）
**BDD 来源：** `feature.feature :: Scenario: xxx`
**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: 写失败测试**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: 写最小实现**

```python
def function(input):
    return expected
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

## 修改已有文件的步骤格式

当 Step 涉及修改已有文件时，必须展示：

1. 文件路径和行号范围
2. 完整的变更后代码（不是 diff）

````markdown
- [ ] **Step 3: 在 AuthService 中增加登录方法**

Modify: `src/auth/service.py:45-60`

```python
class AuthService:
    def __init__(self, repo: UserRepository, token_svc: TokenService):
        self._repo = repo
        self._token_svc = token_svc

    async def login(self, username: str, password: str) -> TokenPair:
        user = await self._repo.find_by_username(username)
        if user is None or not verify_password(password, user.password_hash):
            raise InvalidCredentialsError("用户名或密码错误")
        return self._token_svc.generate_pair(user.id)
```
````

**禁止只写"在 XX 行后面插入以下代码"——必须展示完整的上下文。**

## 非 TDD 任务模板

### 数据库迁移任务

````markdown
### Task N: 创建 users 表迁移

**Depends on:** Task X
**BDD 来源：** 无（基础设施）
**Files:**
- Create: `alembic/versions/001_create_users.py`

- [ ] **Step 1: 写迁移脚本**

```python
def upgrade():
    op.create_table(
        'users',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('username', sa.String(64), unique=True, nullable=False),
        sa.Column('email', sa.String(255), unique=True, nullable=False),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='ACTIVE'),
        sa.Column('failed_login_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('locked_until', sa.DateTime(), nullable=True),
    )

def downgrade():
    op.drop_table('users')
```

- [ ] **Step 2: 本地运行迁移**

Run: `alembic upgrade head`
Expected: 无错误

- [ ] **Step 3: 验证表结构**

Run: `alembic check`
Expected: 无新迁移待生成

- [ ] **Step 4: 提交**
````

### 配置 / 基础设施任务

````markdown
### Task N: 认证配置项

**Depends on:** None
**BDD 来源：** 无（基础设施）
**Files:**
- Create: `src/auth/config.py`

- [ ] **Step 1: 创建配置文件**

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class AuthConfig:
    access_token_expire_seconds: int = 7200
    refresh_token_expire_seconds: int = 2592000
    bcrypt_cost_factor: int = 12
    max_failed_login_attempts: int = 5
    lock_duration_seconds: int = 900
    remember_me_extend_seconds: int = 2592000
```

- [ ] **Step 2: 验证配置可导入**

Run: `python -c "from src.auth.config import AuthConfig; print(AuthConfig())"`
Expected: 输出默认配置值

- [ ] **Step 3: 提交**
````

### 重构任务

````markdown
### Task N: 重构 UserRepository 提取接口

**Depends on:** Task X
**BDD 来源：** 无（纯重构）
**Files:**
- Modify: `src/auth/repository.py:1-30`
- Create: `src/auth/repository_interface.py`

- [ ] **Step 1: 确认已有测试通过**

Run: `pytest tests/test_repository.py -v`
Expected: 全部 PASS

- [ ] **Step 2: 提取接口**

[完整变更后代码]

- [ ] **Step 3: 确认测试仍通过**

Run: `pytest tests/test_repository.py -v`
Expected: 全部 PASS

- [ ] **Step 4: 提交**
````

## 禁止占位符

每个步骤必须包含工程师需要的实际内容。以下模式属于 **计划不合格**，绝对不能出现：

- "TBD"、"TODO"、"稍后实现"、"补充细节"
- "添加适当的错误处理" / "添加验证" / "处理边界情况"（不附带具体代码）
- "为上述代码写测试"（不附带实际测试代码）
- "类似 Task N"（必须重复代码——工程师可能乱序阅读任务）
- 只描述做什么但不展示怎么做（代码步骤必须有代码块）
- 引用未在任何 Task 中定义的类型、函数或方法
- "在 XX 行后面插入"而不展示完整上下文

## 自检清单

写完全部计划后，用以下清单逐项检查：

**1. 规格覆盖：** 逐条过 BDD 的每个 Scenario，能否指向一个实现它的 Task？列出所有缺口。

**2. 占位符扫描：** 搜索计划中的禁止模式（见上方"禁止占位符"）。发现即修复。

**3. 类型一致性：** 后续 Task 中使用的类型、方法签名、属性名是否与先前 Task 中定义的一致？Task 3 叫 `clearLayers()` 但 Task 7 叫 `clearFullLayers()` 就是一个 bug。

**4. 术语一致性：** 状态名、产物名、字段名、API 名是否与 BDD / ADD / Flow 完全一致？

**5. 依赖一致性：** 依赖关系表中的依赖是否与实际 Task 间引用关系一致？是否所有被引用的类型/函数都已在依赖 Task 中定义？是否存在环？

**6. BDD 追踪完整性：** 每个 Task 是否都标注了 BDD 来源？BDD 中每个 Scenario 是否都有 Task 覆盖？

发现问题就地修复，无需重新自检。发现 BDD 场景没有对应 Task 的，补上 Task。

## 执行交接协议

计划保存后，提供执行选择：

**"计划已保存至 `docs/xdd/plan/<filename>.md`。两种执行方式：**

**1. 逐任务分派（推荐）** — 每个 Task 派发一个独立子代理，任务间 review，快速迭代

**2. 内联执行** — 在当前会话中按计划逐步执行，批量执行 + 检查点 review

**选择哪种方式？"**

### 进度标记规范

执行者通过修改 checkbox 推进状态：

| 标记 | 含义 |
|---|---|
| `- [ ]` | 待执行 |
| `- [~]` | 执行中 |
| `- [x]` | 已完成 |
| `- [!]` | 阻塞（必须附阻塞原因） |

### 阻塞上报

执行者遇到以下情况应暂停并上报：

- 计划中标注"待确认"的内容
- 代码与计划不一致（文件不存在、行号不匹配、函数签名不同）
- 测试结果与预期不符
- 缺少未声明的依赖
- 需要修改计划结构

### 计划调整流程

1. 执行者暂停当前 Task，标记为 `- [!]`
2. 上报调整原因（附具体信息）
3. 计划者修改计划后更新文件
4. 执行者从暂停点继续

**执行者不得自行修改计划结构**，但可以修复代码中的拼写错误和路径错误。

## 标准输出模板

```markdown
# [功能名称] 实现计划

> **给执行工程师：** 按顺序执行每个 Task，每个 Step 用 checkbox 标记进度。遇到"待确认"立即停下问人。

**目标：** [一句话描述]

**架构：** [2-3 句方案]

**技术栈：** [关键依赖]

**验收来源：** [BDD 文件路径]

---

## 文件结构

| 文件路径 | 操作 | 职责 |
|---|---|---|
| `path/to/new_file.py` | Create | [职责] |
| `path/to/existing.py` | Modify: 123-145 | [变更内容] |
| `tests/path/test.py` | Create | [测试覆盖] |

---

## 依赖关系

| Task | Depends On | 可并行 |
|---|---|---|
| Task 1 | None | 是 |
| Task 2 | None | 是 |
| Task 3 | Task 1 | 否 |

---

## BDD 覆盖追踪

| BDD Scenario | Task | 状态 |
|---|---|---|
| `login.feature :: Scenario: 密码登录成功` | Task 6 | - [ ] |
| `login.feature :: Scenario: 密码错误` | Task 7 | - [ ] |
| `login.feature :: Scenario: 账号锁定` | Task 10 | - [ ] |

---

### Task 1: [行为路径名称]

**Depends on:** None
**BDD 来源：** 无（基础设施）
**Files:**
- Create: `exact/path/to/file.py`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: 写失败测试**

[test code]

- [ ] **Step 2: 跑测试确认失败**

Run: `command`
Expected: FAIL

- [ ] **Step 3: 写最小实现**

[implementation code]

- [ ] **Step 4: 跑测试确认通过**

Run: `command`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add ... && git commit -m "feat: ..."
```

---

## 自检结果

- [x] BDD Scenario 覆盖：每个 Scenario 有对应 Task
- [x] 占位符扫描：无 TBD / TODO / 空话
- [x] 类型一致性：跨 Task 类型名一致
- [x] 术语一致性：与 BDD / ADD / Flow 术语对齐
- [x] 依赖一致性：无环、引用已定义、可并行标记正确
- [x] BDD 追踪完整：每个 Task 有来源、每个 Scenario 有 Task
```

## 输出质量门禁

生成计划后，自检以下问题：

- 是否每个 Task 都包含精确文件路径？
- 是否每个代码步骤都包含完整代码？
- 是否每个验证步骤都包含精确命令和预期输出？
- 是否没有 TBD / TODO / 空话占位符？
- 是否每个 Task 聚焦单一行为路径、步骤数 ≤ 7？
- 是否遵循 TDD（先测试后实现）？
- 是否每个 Task 结尾都有提交步骤？
- 是否覆盖 BDD 中所有 Scenario（含异常路径）？
- 是否与 ADD 中的架构战术保持一致？
- 是否与 Flow 中的组件名、协议名保持一致？
- 是否未知内容标注为"待确认"而非编造？
- 状态名、字段名、API 名是否与 BDD / ADD / Flow 完全一致？
- 是否每个 Task 都声明了依赖关系？
- 依赖关系是否无环？
- 是否每个 Task 都标注了 BDD 来源？
- 是否有 BDD 覆盖追踪表？
- 修改已有文件的步骤是否展示了完整上下文代码？
