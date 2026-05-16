# {slug} 质量规划

> 6 维质量规划
> 对应业务线: {biz_dir}

---

## 1. 错误处理

### 1.1 错误码定义规范

- 格式: `{SLUG}-E{3位数字}`
- 示例: `{slug}-E001`, `{slug}-E002`

### 1.2 错误码列表

| 错误码 | 消息 | HTTP 状态码 |
|--------|------|------------|
| {slug}-E001 | TODO | 400 |
| {slug}-E002 | TODO | 404 |

### 1.3 错误响应格式

```json
{
  "error": {
    "code": "{slug}-E001",
    "message": "用户友好的错误消息",
    "details": {}
  }
}
```

## 2. 输入校验

### 2.1 校验库选择

- **后端**: TODO (如: pydantic, class-validator, Joi)
- **前端**: TODO (如: Yup, Zod)

### 2.2 校验规则示例

```python
# Python + Pydantic 示例
from pydantic import BaseModel, EmailStr

class UserCreateRequest(BaseModel):
    email: EmailStr
    password: str  # min_length=8
```

## 3. 日志

### 3.1 日志级别

- ERROR: 系统错误，需要立即处理
- WARN: 警告，可能需要关注
- INFO: 一般信息
- DEBUG: 调试信息（仅开发环境）

### 3.2 追踪方案

- request_id: 每个请求唯一 UUID
- user_id: 已登录用户的 ID
- timestamp: ISO 8601 格式

### 3.3 日志格式

```
[{timestamp}] [{level}] [request_id={request_id}] [user_id={user_id}] {message}
```

## 4. 安全

### 4.1 鉴权检查点

- [ ] 路由级别鉴权
- [ ] 服务级别鉴权
- [ ] 数据级别鉴权

### 4.2 敏感数据处理

- 密码: bcrypt/argon2 哈希存储
- 手机号: AES-256 加密存储
- API 密钥: 环境变量存储

### 4.3 参数化查询

- **强制**: 所有数据库查询必须使用参数化查询
- **禁止**: 字符串拼接 SQL

## 5. 性能

### 5.1 分页策略

- 默认页大小: 20
- 最大页大小: 100
- 偏移分页 vs 游标分页: TODO

### 5.2 N+1 避免

- 使用 JOIN 查询
- 使用 ORM 的 eager loading
- 使用 DataLoader 模式

### 5.3 流式处理

- 大数据量导出使用流式响应
- SSE/Websocket 用于实时通知

## 6. 启动配置（强制）

### 6.1 后端启动命令

```bash
# TODO: 根据技术栈选择
cd backend && python -m uvicorn app.main:app --reload
```

### 6.2 前端启动命令

```bash
cd frontend && npm run dev
```

### 6.0 启动命令状态

- 一键启动命令已配置: 是

### 6.3 环境变量配置

```bash
# .env.example
DATABASE_URL=postgresql://localhost:5432/{slug}
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
```

### 6.4 必需环境变量

- [ ] DATABASE_URL
- [ ] REDIS_URL (如适用)
- [ ] JWT_SECRET
- [ ] API_BASE_URL

---

**自检清单**:
- [ ] 6 维质量均已规划
- [ ] 错误码已定义
- [ ] 校验规则已示例
- [ ] 日志格式已确定
- [ ] 安全措施已列出
- [ ] 性能策略已明确
- [ ] **一键启动命令已配置**
