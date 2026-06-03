# Phase 4-6 详细步骤：API 端点验证 / Playwright E2E / 系统漫游 / 后端 E2E

> 本文件从 SKILL.md 拆分，包含 Phase 4 到 Phase 6 的完整 bash 命令和诊断细节。

---

## 目录

- [Phase 4: API 端点验证（通过 docker compose）](#phase-4-api-端点验证通过-docker-compose)
- [Phase 5: 前端 E2E 验证 — Playwright（如有前端）](#phase-5-前端-e2e-验证-playwright如有前端)
- [Phase 5.6: 系统漫游测试（Exploratory Wander Test）](#phase-56-系统漫游测试exploratory-wander-test)
- [Phase 6: 后端 E2E 场景验证](#phase-6-后端-e2e-场景验证)

## Phase 4: API 端点验证（通过 docker compose）

```bash
# 健康端点 — 通过 docker compose exec 和服务外部 curl 双重验证
echo "=== 内部验证（容器内）==="
docker compose exec -T backend curl -s -o /dev/null -w "HEALTH_INTERNAL:%{http_code}" http://localhost:3002/api/health

echo "=== 外部验证（宿主机）==="
CURL_OUT=$(curl -s -o /dev/null -w "HEALTH_EXTERNAL:%{http_code}" --connect-timeout 5 http://127.0.0.1:3002/api/health 2>&1)
echo "$CURL_OUT"

# 关键业务端点
echo "=== 业务端点 ==="
for endpoint in /api/projects /api/tasks /api/annotations; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://127.0.0.1:3002${endpoint}" 2>/dev/null || echo "CURL_FAIL")
  echo "${endpoint}: HTTP ${HTTP_CODE}"
  # 非200时提取响应体诊断
  if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
    echo "  BODY: $(curl -s "http://127.0.0.1:3002${endpoint}" 2>/dev/null | head -5)"
  fi
done
```

**如果 API 端点返回非 200** → 不要直接略过，诊断原因：
1. 是否返回了具体的错误 JSON（`curl -s 端点 | head -20`）
2. 是否认证问题（检查是否需要 Authorization header）
3. 是否数据库未初始化（`docker compose exec -T backend npm run db:migrate`）
4. 容器内网络是否正常（`docker compose exec -T backend curl localhost:3002`）

---

## Phase 5: 前端 E2E 验证 — Playwright（如有前端）

如果项目包含前端，**必须使用 Playwright CLI 进行端到端测试**，不能只做 HTTP 可达性检查。

L2 e2e.md 中的真实场景必须被 Playwright 测试覆盖。

### 5.1 安装 Playwright

```bash
# Playwright CLI 全局安装（如未安装）
npx playwright install --with-deps chromium 2>&1 | tail -5
echo "PLAYWRIGHT_INSTALL_STATUS: $?"

# 检查 Playwright 配置文件
[ -f playwright.config.ts ] || [ -f playwright.config.js ] \
  && echo "PLAYWRIGHT_CONFIG_EXISTS" \
  || echo "PLAYWRIGHT_CONFIG_MISSING"
```

如果 Playwright 配置文件不存在 — 从项目根或 frontend/ 目录检查，仍没有则生成临时配置：

```bash
# 项目根目录
[ -f playwright.config.ts ] && echo "CONFIG_IN_ROOT" && PLAYWRIGHT_DIR="."
# frontend 子目录
[ -f frontend/playwright.config.ts ] && echo "CONFIG_IN_FRONTEND" && PLAYWRIGHT_DIR="frontend"
# 测试目录
[ -f e2e/playwright.config.ts ] && echo "CONFIG_IN_E2E" && PLAYWRIGHT_DIR="e2e"
```

### 5.2 确认前端服务容器已就绪

```bash
FRONTEND_PORT=$(grep -oP 'FRONTEND_PORT=\K\d+' .env 2>/dev/null || echo "80")
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"

# 前端可达性检查
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 "$FRONTEND_URL/" 2>/dev/null || echo "CURL_FAIL")
echo "FRONTEND_HTTP: $HTTP_CODE"

if [ "$HTTP_CODE" = "CURL_FAIL" ] || [ "$HTTP_CODE" = "000" ]; then
  echo "FRONTEND_UNREACHABLE — 诊断:"
  docker compose ps frontend 2>/dev/null
  docker compose logs --tail=20 frontend 2>/dev/null
  echo "FRONTEND_SKIP_PLAYWRIGHT: 前端不可达，Playwright 测试跳过"
  FRONTEND_READY=false
else
  FRONTEND_READY=true
fi
```

### 5.3 运行 Playwright 测试

```bash
if [ "$FRONTEND_READY" = true ]; then
  echo "=== Playwright E2E — 针对运行中的 dev 服务 ==="
  echo "Target: $FRONTEND_URL"
  
  # 如果有项目内置的 Playwright 配置
  if [ -n "$PLAYWRIGHT_DIR" ]; then
    cd "$PLAYWRIGHT_DIR" && npx playwright test --reporter=list 2>&1
    PW_EXIT=$?
    echo "PLAYWRIGHT_TEST_EXIT: $PW_EXIT"
    cd - > /dev/null
  else
    # 无配置时，用临时配置运行基本场景
    echo "NO_PLAYWRIGHT_CONFIG — 使用临时配置运行基本场景"
    npx playwright test --reporter=list \
      --config <(cat <<'EOF'
        import { defineConfig } from '@playwright/test';
        export default defineConfig({
          testDir: '.',
          use: { baseURL: '$FRONTEND_URL', headless: true },
          projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
        });
      EOF) 2>&1 || echo "PLAYWRIGHT_CONFIG_FAILED"
  fi
  
  echo "=== Playwright 报告 ==="
  # 检查是否有 HTML 报告生成
  ls -la playwright-report/ 2>/dev/null && echo "PLAYWRIGHT_REPORT_EXISTS" || echo "NO_PLAYWRIGHT_REPORT"
fi
```

### 5.4 Playwright 测试覆盖要求

| 要求 | 说明 |
|------|------|
| 测试目标 | 必须是 **docker compose 运行中的前端 dev 服务**（不是 mock） |
| 浏览器 | 至少 Chromium（headless 模式） |
| 场景 | 覆盖 L2 `uat-script.md` 中全部 P0 用户验收剧本，至少 2 个前端真实场景 |
| 用户流程 | 登录 → 导航 → 核心操作 → 等待反馈 → 查看结果 → 退出 |
| API 交互 | 验证前端正确调用了后端 API（检查网络请求） |
| 响应式 | 至少一种视口（1920x1080 桌面） |
| 证据 | 截图、trace、网络请求、最终状态断言必须落盘 |

### 5.5 诊断：Playwright 测试失败

| 假设 | 验证方法 |
|------|---------|
| 前端 URL 错误 | curl $FRONTEND_URL 看是否能访问 |
| CORS 问题 | 浏览器控制台检查跨域错误 |
| API 未就绪 | 直接 curl 后端 API 检查 |
| 端口映射错误 | docker compose ps 查看前端端口 |
| Playwright 浏览器缺失 | npx playwright install --with-deps chromium |
| 测试超时 | 增加 playwright.config.ts 中的 timeout 值 |

---

## Phase 5.6: 系统漫游测试（Exploratory Wander Test）

> 像真实用户第一次拿到系统一样，随便逛、随便点、随便输入。
> 脚本化测试验证的是"我们想验证的"，漫游测试发现的是"我们没想过的"。

**适用范围**：有前端的项目。纯后端/API 项目豁免。

**核心定位**：Phase 5 验证已知路径，Phase 7 验证用户验收剧本，**Phase 5.6 发现未知问题**。

详细方法论参考：`references/exploratory-wander.md`。

### 5.6.1 前置条件

- Phase 3 的 docker compose 服务仍在运行
- Phase 5.2 的前端可达性检查已通过（`FRONTEND_READY=true`）
- Playwright CLI 可用（已在 Phase 5.1 安装）

如果前端不可达或纯后端项目 → 跳过本 Phase，报告标注 `WANDER_SKIP: 无前端`。

### 5.6.2 执行漫游

可使用自动漫游脚本 `scripts/wander-test.sh`，也可手动执行 Playwright CLI 命令。

**方式一：自动漫游脚本**

```bash
bash skills/shadow-l6-deploy/scripts/wander-test.sh <slug> "$FRONTEND_URL" "{迭代作用域}/L6-deploy/{slug}/wander-evidence"
```

**方式二：手动 Playwright CLI 漫游**

按以下 5 层策略逐层执行：

**层 1：页面发现 + 全量截图**

```bash
playwright-cli open "$FRONTEND_URL"
sleep 3

# 注入错误捕获脚本（完整脚本见 references/exploratory-wander.md 层2）
playwright-cli evaluate "..." # console.error + unhandled rejection + network error 捕获

# 从首页开始 DFS
playwright-cli snapshot > wander-home.txt
playwright-cli screenshot > wander-evidence/screenshots/wander-01-home.png

# 提取所有链接并逐个访问
playwright-cli evaluate "JSON.stringify(Array.from(document.querySelectorAll('a[href]')).map(a=>a.href).filter(h=>h.startsWith('$FRONTEND_URL')))" 2>/dev/null

# 对每个链接：goto → 等待 → screenshot → snapshot → 检查错误
# 维护已访问 URL 集合，避免循环
# 最大深度 5 层
```

**层 2：浏览器错误捕获**

每次页面切换后查询累积错误：

```bash
playwright-cli evaluate "JSON.stringify(window.__wander_errors || [])" 2>/dev/null
playwright-cli evaluate "JSON.stringify(window.__wander_network_errors || [])" 2>/dev/null
```

**层 3：表单胡搞**

对每个页面中的表单，尝试异常输入：

```bash
# 识别表单
playwright-cli evaluate "JSON.stringify(Array.from(document.querySelectorAll('form')).map((f,i)=>({index:i,inputs:Array.from(f.querySelectorAll('input,textarea,select')).map(el=>el.name||el.id)})))"

# 空值提交
playwright-cli fill e_input ""
playwright-cli click e_submit
playwright-cli screenshot > wander-evidence/screenshots/wander-XX-form-empty.png

# 特殊字符
playwright-cli fill e_input "<script>alert(1)</script>"
playwright-cli click e_submit
playwright-cli screenshot > wander-evidence/screenshots/wander-XX-form-xss.png

# 超长输入
playwright-cli fill e_input "$(python3 -c 'print("A"*10000)')"
playwright-cli click e_submit
playwright-cli screenshot > wander-evidence/screenshots/wander-XX-form-long.png
```

**层 4：死胡同检测**

```bash
playwright-cli evaluate "JSON.stringify({
  hasBackNav: !!document.querySelector('a[href*=\"..\"], [aria-label*=\"back\"], .breadcrumb, nav a'),
  hasNavLinks: document.querySelectorAll('nav a, header a').length,
  currentUrl: window.location.href
})"
```

**层 5：视觉一致性扫描**

```bash
# 桌面视口
playwright-cli screenshot --viewport="1920,1080" > wander-evidence/screenshots/wander-XX-desktop.png

# 平板视口
playwright-cli screenshot --viewport="768,1024" > wander-evidence/screenshots/wander-XX-tablet.png

# 检查空状态（列表页面）
playwright-cli evaluate "document.querySelector('.empty-state, [data-empty], .no-data, .no-results') ? 'HAS_EMPTY_STATE' : 'MISSING_EMPTY_STATE'"
```

### 5.6.3 漫游证据包

所有证据保存到 `{迭代作用域}/L6-deploy/{slug}/wander-evidence/`：

```
wander-evidence/
  page-map.json          # 页面地图（URL、标题、深度、截图路径）
  screenshots/           # 每个页面的截图（桌面 + 平板）
    wander-01-home.png
    wander-02-dashboard.png
    wander-03-form-error.png
    ...
  console-errors.json    # console 错误汇总（按页面分组）
  network-errors.json    # HTTP 4xx/5xx 汇总（按页面分组）
  issues.json            # 发现的问题清单
  wander-report.md       # 人类可读的汇总报告
```

### 5.6.4 问题分级与阻塞策略

**P0 — 阻塞 L6 PASS**（必须修复）：

| 类型 | 判定标准 |
|------|----------|
| JS 崩溃白屏 | 页面完全无法渲染，console 有未捕获异常 |
| 核心流程中断 | 用户无法完成主要操作（无法登录、无法提交、无法导航到核心页面） |
| 数据丢失 | 操作后数据消失或不一致 |
| 安全漏洞 | XSS 执行、敏感信息暴露、认证绕过 |
| 死胡同卡死 | 用户到达某页面后完全无法离开（浏览器后退也失效） |

发现 P0 问题 → **L6 不得 PASS**。报告必须包含：截图证据、console 输出、根因分析（精确到代码层面）、具体修复建议。

**P1 — 记录 + 修复建议**（不阻塞但必须报告）：

| 类型 | 判定标准 |
|------|----------|
| 样式不一致 | 不同页面 header/footer/nav 风格差异明显 |
| 空状态无提示 | 列表为空时显示空白而非友好提示 |
| Loading 缺失 | 操作无反馈 |
| 表单验证不完整 | 某些字段没有前端验证但后端会拒绝 |
| 小交互问题 | tooltip 不消失、dropdown 位置错、焦点异常 |
| 响应式瑕疵 | 非桌面视口下局部布局错乱 |

P1 问题每条必须有截图 + 修复建议。

**P2 — 必须修复**（不阻塞 L6 PASS 但必须修复）：性能偏慢、文案不统一、响应式小瑕疵。P2 不修 = 体验不过关 = 用户会投诉。

### 5.6.5 诊断：漫游发现问题

| 问题现象 | 诊断方向 |
|---------|---------|
| 页面白屏 | 检查 console TypeError/ReferenceError → 定位到缺失的 null check 或未导入的组件 |
| Console 报错 | 区分：React/Vue 框架错误 vs 业务逻辑错误 vs 第三方库错误 |
| HTTP 404 | 前端路由是否与后端 API 路径一致 |
| HTTP 500 | 后端异常堆栈是否暴露给前端 → 安全问题 |
| XSS 触发 | 定位渲染逻辑是否使用了 innerHTML 或 v-html |
| 空表单提交成功 | 前端缺少 required 校验 → 后端也缺少校验 |
| 死胡同 | 路由配置缺少返回导航 → 检查 layout 组件 |
| 空状态缺失 | 列表组件没有 empty state 分支 → 添加条件渲染 |
| 样式不一致 | 页面未使用公共 layout → 检查路由嵌套 |
| 超长输入崩溃 | 前端未做 maxlength 限制 → 后端也未做字段长度校验 |

### 5.6.6 问题追踪与修复反馈

漫游发现的所有问题必须写入 `wander-evidence/issues.json`，供 Shadow team 派发修复 agent。每条问题的 JSON 格式：

```json
{
  "id": "P0-1",
  "level": "P0",
  "page_url": "/dashboard",
  "operation": "点击'导出'按钮",
  "symptom": "页面白屏，无任何内容渲染",
  "screenshot": "wander-03.png",
  "console_error": "TypeError: Cannot read properties of undefined (reading 'export')",
  "network_error": null,
  "root_cause": "src/components/Dashboard.vue 第 42 行：this.exportData 未做 null check，当用户无导出权限时 exportData 为 undefined",
  "fix_suggestion": "在 Dashboard.vue 第 42 行添加 if (!this.exportData) return; 或显示'无导出权限'提示",
  "suggested_agent": "shadow-l5-impl",
  "trace_to_design": null
}
```

**字段要求**：

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `id` | 是 | 编号格式：`P{级别}-{序号}` |
| `level` | 是 | P0/P1/P2 |
| `page_url` | 是 | 问题出现时的页面 URL |
| `operation` | 是 | 具体操作（点击了什么/输入了什么） |
| `symptom` | 是 | 用户看到的现象（用用户视角描述） |
| `screenshot` | 是 | 截图文件名 |
| `console_error` | 否 | console 输出原文（无则为 null） |
| `network_error` | 否 | HTTP 错误详情（无则为 null） |
| `root_cause` | 是 | 根因分析（精确到代码文件和行/逻辑） |
| `fix_suggestion` | 是 | 具体修复方案（精确到文件和改动点） |
| `suggested_agent` | 是 | 建议的修复 agent |
| `trace_to_design` | 否 | 如果是设计层缺失，指出需要回退到哪个 L1 层 |

**根因分析深度要求**：

- P0 问题：必须精确到**代码文件 + 函数/组件名 + 具体哪一行逻辑缺失**
- P1 问题：至少精确到**代码文件 + 模块名 + 缺失的逻辑类型**
- `trace_to_design` 字段：如果问题根因是设计层遗漏，必须标注回退层：
  - `"shadow-l1-wire: 缺少空状态设计"` — Wire 层遗漏
  - `"shadow-l1-research: 用户旅程未覆盖此操作路径"` — Research 层遗漏
  - `"shadow-l1-spec: 缺少表单验证规则"` — Spec 层遗漏
  - `null` — 纯实现缺陷，不回退设计层

**建议责任 agent 路由**：

| 问题类型 | `suggested_agent` | `trace_to_design` |
|----------|-------------------|-------------------|
| JS 崩溃白屏 | `shadow-l5-impl` | null |
| 核心流程中断 | `shadow-l5-impl` | null |
| 安全漏洞（XSS） | `shadow-l5-impl` | null |
| 死胡同页面 | `shadow-l1-wire` | `"shadow-l1-wire: 缺少返回导航设计"` |
| 空状态无提示 | `shadow-l1-wire` | `"shadow-l1-wire: 缺少空状态设计"` |
| Loading 缺失 | `shadow-l1-wire` | `"shadow-l1-wire: 缺少加载状态设计"` |
| 样式不一致 | `shadow-l5-impl` | null |
| 表单验证缺失 | `shadow-l5-impl` | null 或 `"shadow-l1-spec: 缺少校验规则"` |
| 响应式错乱 | `shadow-l5-impl` | null |
| Console 非致命错误 | `shadow-l5-impl` | null |
| HTTP 4xx/5xx | `shadow-l5-impl` | null |
| 工作流卡点 | `shadow-l1-research` | `"shadow-l1-research: 用户旅程遗漏"` |

### 5.6.7 通过标准

漫游测试 PASS 必须同时满足：
- **P0 问题数为 0**。有 P0 = L6 不能 PASS。
- **P1 问题全部修复**。不允许带着 P1 交付。
- **P2 问题全部修复**。P2 不修 = 体验不过关 = 用户会投诉。
- **全量覆盖**：DFS 遍历了所有导航入口可达的页面（≥ 3 层深度）。
- **证据完整**：页面地图、截图集合、console 错误日志、network 错误日志全部存在。
- **issues.json 完整**：所有发现的问题都记录，每条有根因分析和修复建议。
- **设计层回退标注**：根因在设计层的问题，`trace_to_design` 字段不为空。

---

## Phase 6: 后端 E2E 场景验证

**核心要求：所有测试必须针对 `docker compose` 启动并正在运行的 dev 服务执行。**

不得使用独立的测试数据库启动方式，必须复用 Phase 3 启动的 dev 服务。

### 6.1 验证 dev 服务仍在运行

```bash
echo "=== 验证 dev 服务状态 ==="
docker compose ps --services --filter status=running 2>/dev/null
echo "RUNNING_COUNT: $(docker compose ps --services --filter status=running | wc -l)"

# 确认后端可达
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://127.0.0.1:3002/api/health 2>/dev/null || echo "FAIL")
echo "BACKEND_HEALTH: $HEALTH_CODE"
if [ "$HEALTH_CODE" != "200" ]; then
  echo "BACKEND_NOT_READY — 中止 E2E，先修复服务启动"
  exit 1
fi
```

### 6.2 准备测试数据

在运行 E2E 场景前，通过 dev 服务的 API 注入测试数据：

```bash
echo "=== 准备 E2E 测试数据 ==="

# 创建测试项目
curl -s -X POST http://127.0.0.1:3002/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "E2E Test Project", "description": "Auto-generated for L6 validation"}' 2>&1

# 创建测试任务（至少 100 条记录 — 模拟生产数据量）
for i in $(seq 1 100); do
  curl -s -X POST http://127.0.0.1:3002/api/tasks \
    -H "Content-Type: application/json" \
    -d "{\"project_id\": \"$PROJECT_ID\", \"title\": \"E2E Task $i\"}" > /dev/null
done
echo "TEST_DATA_INJECTED: 100 tasks"
```

### 6.3 运行 E2E 测试

```bash
echo "=== 后端 E2E — 针对运行中的 dev 服务 ==="

# 方式一：容器内运行集成测试（推荐）
echo "METHOD: container exec"
docker compose exec -T backend npm run test:e2e 2>&1
E2E_EXIT=$?
echo "E2E_TEST_EXIT: $E2E_EXIT"

# 方式二：宿主机通过暴露端口做 API 场景验证
echo "METHOD: API scenario replay"
# 从 L2 e2e.md 选取关键场景，用 curl 序列模拟
# 场景：标注员完整工作流
echo "--- SCENARIO: annotator workflow ---"
curl -s -X POST http://127.0.0.1:3002/api/annotations \
  -H "Content-Type: application/json" \
  -d '{"task_id": "{{TASK_ID}}", "values": [{"label_id": "uuid", "type": "text", "text": "sample annotation"}]}' 2>&1 | head -5

# 方式三：使用测试 compose profile（仍共享 dev 数据库服务）
echo "METHOD: test profile"
docker compose --profile test run --rm backend-test npm run test 2>&1 | tail -20
```

### 6.4 E2E 测试覆盖要求

| 要求 | 说明 |
|------|------|
| 测试目标 | **docker compose 启动并正在运行的 dev 服务**（不是独立测试容器） |
| 测试数据 | 生产级数据量（≥100 条记录） |
| 场景覆盖 | L2 e2e.md 中每个核心规则至少 1 个 E2E 场景 |
| 真实场景 | 至少覆盖 L2 中 2 个多步骤真实场景 |
| 数据清理 | 测试完成后清理注入的数据（或重建测试数据库） |
| 测试结果 | 全部 GREEN 才算 E2E 通过 |

### 6.5 诊断：E2E 测试失败

| 假设 | 验证方法 |
|------|---------|
| 服务未启动 | `docker compose ps` 检查服务状态 |
| 数据库未初始化 | `docker compose exec -T backend npm run db:migrate:status` |
| 测试数据冲突 | 检查之前测试是否有残留数据 |
| API 版本不匹配 | 对比前端请求和后端路由定义 |
| 权限不足 | 检查测试 token 是否有效 |
