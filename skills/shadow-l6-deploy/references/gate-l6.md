## L6 Gate — 部署验证

### 工具调用

```bash
# 1. 识别启动方式并检查配置存在性
# 优先检查 Docker，其次检查原生启动方式
if [ -f "docker-compose.yml" ] || [ -f "docker-compose.yaml" ]; then
  echo "STARTUP_MODE=docker-compose"
  ls Dockerfile docker-compose.yml .env.example 2>&1
elif [ -f "package.json" ]; then
  echo "STARTUP_MODE=npm"
  grep -E '"(start|dev|serve)"' package.json 2>&1
elif [ -f "pyproject.toml" ] || [ -f "requirements.txt" ] || [ -f "Pipfile" ]; then
  echo "STARTUP_MODE=python"
  ls pyproject.toml requirements.txt Pipfile Makefile 2>&1
else
  echo "STARTUP_MODE=unknown"
  echo "WARN: 未识别到标准启动配置，检查 Makefile/Procfile/启动脚本"
  ls Makefile Procfile start.sh run.sh 2>&1
fi

# 2. 构建/准备（仅 Docker 模式需要）
if [ -f "docker-compose.yml" ] || [ -f "docker-compose.yaml" ]; then
  docker compose build 2>&1
  echo "BUILD_EXIT_CODE=$?"
fi

# 3. 启动服务（按识别的方式）
# Docker 模式:
#   docker compose up -d 2>&1
#   docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
# npm 模式:
#   npm run start &  或  npm run dev &
# Python 模式:
#   uv run python -m app &  或  python -m app &
# 记录启动命令和进程状态

# 4. 健康检查（等待最多 60 秒）
for i in $(seq 1 12); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/health 2>/dev/null || echo "000")
  [ "$STATUS" = "200" ] && echo "HEALTH: PASS ($STATUS)" && break
  echo "HEALTH: waiting... attempt $i (status=$STATUS)"
  sleep 5
done

# 5. API 端点验证
for endpoint in /api/v1/health /api/v1/...; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>${endpoint} 2>/dev/null || echo "000")
  echo "${endpoint}: ${STATUS}"
done

# 6. 前端页面可访问性（如适用）
curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/ 2>/dev/null || echo "000"

# 7. 部署验证报告
ls {迭代作用域}/L6-deploy/<slug>/deployment-report.md 2>&1

# 8. L2 e2e 场景文件（验收场景来源）
ls .shadow/L2-e2e/BXX-<slug>/e2e.md 2>&1

# 9. UAT 用户验收剧本与证据包（最终验收来源）
ls .shadow/L2-e2e/BXX-<slug>/uat-script.md 2>&1
ls {迭代作用域}/L6-deploy/<slug>/uat-evidence 2>&1

# 10. 系统漫游测试证据（有前端时）
ls {迭代作用域}/L6-deploy/<slug>/wander-evidence/page-map.json 2>&1
ls {迭代作用域}/L6-deploy/<slug>/wander-evidence/screenshots/ 2>&1
ls {迭代作用域}/L6-deploy/<slug>/wander-evidence/console-errors.json 2>&1
ls {迭代作用域}/L6-deploy/<slug>/wander-evidence/network-errors.json 2>&1
ls {迭代作用域}/L6-deploy/<slug>/wander-evidence/wander-report.md 2>&1
```

### 语义判断

| # | 检查项 | 方法 |
|---|--------|------|
| 1 | 启动方式是否合理且配置完整 | 读 Dockerfile/compose 或 package.json scripts 或 pyproject.toml，检查是否能完整启动所有服务 |
| 2 | 环境变量配置是否完整 | 检查 .env.example 或等效配置，变量名与实际使用一致 |
| 3 | 健康检查端点实现是否合理 | 检查 /health 不暴露敏感信息、不依赖外部服务 |
| 4 | L2 e2e 场景中的 URL/端口与部署配置一致 | 读 L2 e2e.md 的环境章节，对比实际部署端口 |
| 5 | 部署验证报告是否覆盖所有验证项 | 读报告，检查所有章节是否完整 |
| 6 | 启动配置是否有安全隐患（硬编码密钥、root 运行） | grep 检查配置文件中的敏感模式 |
| 7 | 一键启动说明是否清晰 | 读报告中的一键启动章节，新人能否直接复制运行 |
| 8 | UAT 是否像真实用户一样执行 | 读 uat-script.md 和部署报告，确认登录/导航/操作/反馈/退出链路完整 |
| 9 | UAT 证据是否完整 | 检查 uat-evidence 下截图、network.json、assertions/data-proof |
| 9.5 | 前端验收是否有截图 | 使用 `playwright-cli screenshot` 对每个前端页面/UAT 场景截取起始页、关键操作页、最终结果页截图；纯后端/API 项目可豁免 |
| 10 | P0 UAT 是否 100% PASS | 部署报告中 P0 UAT 任一失败则 L6 FAIL |
| 11 | 真正可用验证是否 PASS | 报告必须包含 `real_usability: PASS`，并符合 `real-usability-contract.md` |
| 12 | 持久化证据是否闭合 | 创建数据、查询数据、DB/存储证据、重启后查询同一数据都存在 |
| 13 | 认证证据是否真实 | 登录/鉴权/越权拒绝必须走真实 token/session/seed user |
| 14 | 可用性偷懒检查 | API 200/201、单元测试总数、InMemoryRepository/mock DB/假登录不能作为 PASS 证据 |
| 15 | 生产级验收是否 PASS | 报告必须包含 `production_acceptance: PASS`，并符合 `production-acceptance-contract.md` |
| 16 | 生产级闭环是否完整 | 业务/数据/权限/状态/异常/UX/集成/运维/性能/证据闭环均有证据 |
| 17 | 真实工作可依赖性 | 报告能回答“真实用户是否愿意在真实工作中依赖它”，不能只证明功能已实现 |
| 18 | 系统漫游测试章节存在 | 有前端时，部署报告必须包含 Phase 5.6 系统漫游测试章节；纯后端项目可豁免 |
| 19 | 漫游页面地图完整 | 读 wander-evidence/page-map.json，DFS 深度 ≥ 3 层，覆盖所有导航入口可达页面 |
| 20 | 漫游截图证据存在 | wander-evidence/screenshots/ 包含每个页面的截图 |
| 21 | 漫游错误证据充分 | wander-evidence/ 下 console-errors.json 和 network-errors.json 存在 |
| 22 | 漫游 P0 问题有根因+修复建议 | 读 issues.json 或 wander-report.md，每个 P0 问题必须有截图、console/network 证据、根因分析（精确到代码层）、具体修复建议 |
| 23 | 漫游 P0 为 0 | 有 P0 问题 → L6 不得 PASS，报告中结论不得写 DEPLOY_PASS |
| 24 | 漫游无偷懒 | 页面地图/截图/错误日志完整；"漫游发现无明显问题"但无页面地图/截图 = 打回 |
| 25 | D9 全页面截图完整 | 截图数 >= wire.svg 的 data-page 数量，每张 >= 10KB；缺少任何一个页面的截图 = FAIL |
| 26 | D10 全交互点截图完整 | 每个交互点有操作前+操作后截图；表单有空态+填充态+结果态；缺少任何操作截图 = FAIL |
| 27 | D11 多角色截图独立 | 每个角色有独立截图集，不同角色截图不共用；截图总数 >= 角色数 × 该角色可见页面数 |
| 28 | D13 截图完整性门禁 | 截图总数 >= D9预期 + D10预期 + D11预期；任何截图 < 10KB = FAIL；缺少任何截图的元数据 = FAIL |
| 29 | 截图目录非空 | wander-evidence/screenshots/ 目录存在且包含 .png 文件；目录不存在或为空 = FAIL |
| 30 | 截图无白屏 | 所有截图文件大小 >= 10KB；< 10KB 的截图 = 白屏 = FAIL，必须重新截图 |

---

## 内容变更传导检测（替代时间戳 staleness）

```bash
# 初始化/更新 hash（Gate 通过后）
save_hashes() {
  mkdir -p .shadow/.hashes/{l1,l2,l3,l4}
  # L1: spec/flow/research/wire.svg 逐文件 hash
  find .shadow/L1-business/ -maxdepth 1 -name 'project.flow.mermaid' -exec sh -c 'md5sum "$1" > ".shadow/.hashes/l1/$(echo "${1#.shadow/L1-business/}" | tr "/" "_").md5"' _ {} \;
  find .shadow/L1-business/ -mindepth 2 -maxdepth 2 \( -name 'spec.md' -o -name 'flow.mermaid' -o -name 'research.md' \) -exec sh -c 'md5sum "$1" > ".shadow/.hashes/l1/$(echo "${1#.shadow/L1-business/}" | tr "/" "_").md5"' _ {} \;
  find .shadow/L1-business/ -mindepth 2 -maxdepth 2 -name 'wire.svg' -exec sh -c 'md5sum "$1" > ".shadow/.hashes/l1/$(echo "${1#.shadow/L1-business/}" | tr "/" "_").md5"' _ {} \;
  # L2: 目录式路径 .shadow/L2-e2e/BXX-<slug>/e2e.md
  find .shadow/L2-e2e/ -mindepth 2 -maxdepth 2 -name 'e2e.md' -exec sh -c 'md5sum "$1" > ".shadow/.hashes/l2/$(echo "${1#.shadow/L2-e2e/}" | tr "/" "_").md5"' _ {} \;
  # L3: 目录式路径 .shadow/L3-skeleton/ (deprecated)
  # find .shadow/L3-skeleton/ -mindepth 2 -name '*.skel' -exec sh -c 'md5sum "$1" > ".shadow/.hashes/l3/$(echo "${1#.shadow/L3-skeleton/}" | tr "/" "_").md5"' _ {} \;
  # L5 测试代码文件 hash（项目目录下，由 L5 Impl 根据 Harness 计划产出）
  find server/tests/ tests/ client/src/__tests__/ frontend/src/__tests__/ src/__tests__/ \
    -type f \( -name 'test_*.py' -o -name '*_test.py' -o -name '*.test.ts' -o -name '*.spec.ts' \) \
    -exec sh -c 'md5sum "$1" > ".shadow/.hashes/l4/$(echo "$1" | tr "/" "_").md5"' _ {} \;
}

# 检测变更：上层 hash 变了但下层没变 → 传导缺失
check_propagation() {
  # L1 spec 变了？
  # L2 e2e 变了？
  # L5 harness-plan 变了？
  # 逐层对比当前 hash vs 上次保存的 hash
}
```

LLM 在每层 Gate 通过后调用 `save_hashes` 保存快照。下次 Gate 时对比当前 hash 与快照。

---

## 与统一 Gate 脚本 / 语义审查的关系

| 场景 | 用什么 |
|------|--------|
| AI 工作流（Worker→UFW→Gate→Checker） | **Step 1: 语义审查 + bash skills/.../check-*.sh**（双重门禁） |
| CI 管道 / 人类快速查看 | 逐项运行各层 gate-check 脚本 |
| IDE 快速检查 | `bash skills/shadow-l1-flow/scripts/gate-check-l1.sh <slug>`（秒级反馈） |
| 交付前全量检查 | 逐层 gate + shadow-reviewer 全链路审计 |

`gate-check-l*.sh` 负责自动化检查（秒级、可重复、CI 友好）。
语义审查负责读内容、跑测试、curl 端点等深度验证。
**两者互补，缺一不可。**
