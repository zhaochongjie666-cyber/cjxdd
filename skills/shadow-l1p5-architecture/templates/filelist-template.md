# {slug} 文件清单

> L1 Rule To File Mapping
> 对应业务线: {biz_dir}

## 规则到文件映射

| 规则 ID | 文件路径 | 文件类型 | 验证证据 | 备注 |
|---------|----------|---------|---------|------|
| {slug}-R01 | `src/routes/user.routes.ts` | Router | 单元测试 | 用户注册路由 |
| {slug}-R01 | `src/services/user.service.ts` | Service | 单元测试 | 用户注册服务 |
| {slug}-R02 | `src/models/user.model.ts` | Model | 单元测试 | 用户模型 |
| {slug}-R02 | `migrations/001_create_users.sql` | Migration | 集成测试 | 用户表迁移 |

## 文件类型统计

| 类型 | 数量 | 规则覆盖 |
|------|------|---------|
| Router | 0 | - |
| Service | 0 | - |
| Model | 0 | - |
| Component | 0 | - |
| Store | 0 | - |
| API Client | 0 | - |
| Worker | 0 | - |
| Middleware | 0 | - |

## 验证证据汇总

| 类型 | 数量 | 覆盖率 |
|------|------|--------|
| 单元测试 | 0 | -% |
| 集成测试 | 0 | -% |
| 接口测试 | 0 | -% |
| 代码审查 | 0 | -% |

---

**自检清单**:
- [ ] 所有 L1 规则 ID 已映射到文件
- [ ] IF-THEN 规则已应用
- [ ] 每行标注验证证据
- [ ] 文件路径符合规范
