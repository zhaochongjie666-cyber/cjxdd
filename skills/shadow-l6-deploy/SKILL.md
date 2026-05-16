---
name: shadow-l6-deploy
alias: Shadow·L6-Deploy
description: |
  Shadow L6 部署验证 — 穷尽式诊断验证应用可部署、可启动、可测试（后端 + 前端）。
  禁止偷懒归因（"网络问题""环境问题"必须有证据链）。
  每个失败必须穷举至少3种假设并逐个验证。
  最终结论必须满足 Real Usability Contract：真实持久化、真实认证、跨服务链路、重启后数据保留和 P0 UAT 证据。
  最终验收必须满足 Production Acceptance Contract：真实用户愿意在真实工作中依赖它。
  触发：部署、L6、启动、验证。
version: "7.3.0"
---

# Shadow L6 — 部署验证（穷尽诊断版）

## 角色

验证整个应用能跑起来。
最终验收必须像真实用户一样使用系统：用户怎么登录、怎么导航、怎么点击、怎么提交、怎么等待结果、怎么查看反馈，L6 就怎么测。

**核心原则**：失败时必须穷尽诊断。禁止把问题归因于"网络问题"、"环境问题"、"沙箱隔离"等笼统原因
而不提供证据链。如果一次尝试失败，必须至少换3种方式再试，才能确认是真正的阻塞。

**真正可用原则**：服务启动、健康检查 200、API 返回 201、单元测试通过都只是局部证据。最终 `DEPLOY_PASS` 必须符合 `references/real-usability-contract.md`：真实持久化、真实认证、跨服务链路、重启后数据保留和 P0 UAT 证据全部闭合。

**生产级验收原则**：最终 `DEPLOY_PASS` 还必须符合 `references/production-acceptance-contract.md`。验收通过不是“功能都实现了”，而是“真实用户愿意在真实工作中依赖它”。L6 必须证明真实用户可以拿真实数据完成真实工作，系统出错时可发现、可解释、可恢复、可追责。

**漫游质量底线**：Phase 5.6 系统漫游不只是发现问题，更要为修复闭环提供可操作的材料。漫游发现的所有问题（P0/P1/P2，一个不漏）必须详细记录（根因精确到代码层面、修复建议精确到文件和改动点、设计层缺失标注回退层），供 Shadow team 派发正确的修复 agent。不允许带着任何级别的漫游问题交付。不允许只记录不修复。

## 怎么做

**复杂度缩放**：如果 `.shadow/scale.md` 存在且 `l6_core_phases_only = true`，仅执行 Phase 0-3（环境+启动+健康检查）+ Phase 7-9（UAT+报告+自检）。Phase 4-6（API 端点详细验证 + Playwright E2E + 系统漫游 + 后端 E2E）由 Phase 7 UAT 合并覆盖，不再单独执行。否则执行全部 Phase。

### Phase 0: 前置环境验证

在动手之前，先确认执行环境的能力，避免后续误判：

```bash
# 核心工具链 — Docker Compose 是强制要求
which docker           && docker --version        || echo "DOCKER_NOT_FOUND"
which docker compose   && docker compose version  || echo "DOCKER_COMPOSE_NOT_FOUND"
which node            && node --version           || echo "NODE_NOT_FOUND"
which npm             && npm --version            || echo "NPM_NOT_FOUND"  
which curl            && curl --version           || echo "CURL_NOT_FOUND"
which nc              && echo "NC_AVAILABLE"      || echo "NC_NOT_FOUND"

# Playwright（如果包含前端，这是强制工具）
which npx             && npx playwright --version 2>/dev/null || echo "PLAYWRIGHT_NOT_FOUND"
npx playwright install --dry-run 2>/dev/null | head -3 || echo "PLAYWRIGHT_BROWSERS_NOT_CHECKED"

# 端口可用性（从 docker-compose.yml 提取后端+前端端口；如无文件则 fallback 到常见端口）
COMPOSE_FILE="docker-compose.yml"
if [ -f "$COMPOSE_FILE" ]; then
  COMPOSE_PORTS=$(grep -oP '"\d+:\d+"' "$COMPOSE_FILE" | grep -oP '\d+(?=:)' | sort -u | tr '\n' '|' | sed 's/|$//')
  if [ -n "$COMPOSE_PORTS" ]; then
    ss -tlnp | grep -E "($COMPOSE_PORTS)" || echo "PORT_CLEAN"
  else
    echo "COMPOSE_PORTS_EMPTY"
    ss -tlnp | grep -E ":3002|:5173|:8080" || echo "PORT_CLEAN"
  fi
else
  ss -tlnp | grep -E ":3002|:5173|:8080" || echo "PORT_CLEAN"
fi

# Docker Compose 文件检查（强制）
[ -f docker-compose.yml ]       && echo "COMPOSE_PRODUCTION_EXISTS" || echo "COMPOSE_PRODUCTION_MISSING"
[ -f docker-compose.test.yml ]  && echo "COMPOSE_TEST_EXISTS"       || echo "COMPOSE_TEST_MISSING"

# Docker 可用性
docker ps > /dev/null 2>&1 && echo "DOCKER_ACCESSIBLE" || echo "DOCKER_UNREACHABLE"
docker info > /dev/null 2>&1 && echo "DOCKER_INFO_OK" || echo "DOCKER_BROKEN"
```

**Docker compose 是强制启动方式。如果 docker-compose.yml 不存在 = L1.5 架构设计有缺失，记录为架构缺陷后退回。**
**如果包含前端且 Playwright 不可用 = 部署环境不完整，安装后再继续。**

### Phase 1: 检查启动配置（Docker Compose 为主）

```bash
# Docker Compose 文件（强制检查）
[ -f docker-compose.yml ]         && echo "COMPOSE_PROD_EXISTS"     || echo "COMPOSE_PROD_MISSING"
[ -f docker-compose.test.yml ]   && echo "COMPOSE_TEST_EXISTS"     || echo "COMPOSE_TEST_MISSING"
[ -f Dockerfile ]                && echo "DOCKERFILE_EXISTS"       || echo "DOCKERFILE_MISSING"

# 环境变量（必须有 .env 或 .env.example）
[ -f .env ]                      && echo "ENV_EXISTS"
[ -f .env.example ]              && echo "ENV_EXAMPLE_EXISTS"
[ -f .env.test ]                 && echo "ENV_TEST_EXISTS"

# 检查 compose 配置合法性
docker compose config --quiet 2>&1 && echo "COMPOSE_CONFIG_VALID"  || echo "COMPOSE_CONFIG_INVALID"
```

如果 docker-compose.yml 缺失 → **记录架构缺陷**：L1.5 架构未按要求产出 Docker Compose 配置，阻塞部署流程。

### Phase 2: 构建验证（docker compose build）

```bash
# Docker Compose 构建（主方式）
docker compose build 2>&1 | tail -10
BUILD_EXIT=$?
echo "DOCKER_BUILD_STATUS: $BUILD_EXIT"
[ $BUILD_EXIT -eq 0 ] && echo "BUILD_PASS" || echo "BUILD_FAIL"

# 如果 Docker 构建失败 → 降级诊断：尝试直接 npm 构建以区分是 Docker 问题还是代码问题
if [ $BUILD_EXIT -ne 0 ]; then
  echo "DOCKER_BUILD_FAILED — 降级诊断: 尝试直接构建..."
  npm install 2>&1 | tail -5
  npm run build 2>&1 | tail -20
  NPM_BUILD_EXIT=$?
  [ $NPM_BUILD_EXIT -eq 0 ] && echo "NPM_BUILD_PASS (问题在 Dockerfile)" || echo "NPM_BUILD_FAIL (问题在代码)"
fi
```

**如果构建失败** → 诊断原因：
1. Dockerfile 中的基础镜像是否存在（`docker pull node:20-alpine`）
2. Node 版本兼容性（`node --version` vs Dockerfile FROM）
3. TypeScript 错误明细（`npx tsc --noEmit 2>&1 | head -30`）
4. 依赖安装是否成功（对比 package.json 和 node_modules）

### Phase 3: 启动服务 + 多角度健康检查（docker compose 为主）

```bash
# 清理旧容器
docker compose down -v 2>/dev/null || true

# 启动（Docker Compose — 主方式）
docker compose up -d --wait 2>&1
COMPOSE_EXIT=$?
echo "COMPOSE_UP_STATUS: $COMPOSE_EXIT"

if [ $COMPOSE_EXIT -eq 0 ]; then
  # 检查所有服务状态
  docker compose ps
  echo "ALL_SERVICES_STATUS: $(docker compose ps --services --filter status=running | wc -l) running"
  
  # 健康检查 — 逐服务验证
  for svc in $(docker compose ps --services); do
    HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose ps -q $svc)" 2>/dev/null || echo "NO_HEALTHCHECK")
    echo "SERVICE $svc HEALTH: $HEALTH"
  done
  
  # API 健康端点验证
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://127.0.0.1:3002/api/health 2>/dev/null || echo "CURL_FAIL")
  echo "API_HEALTH: HTTP $HTTP_CODE"

else
  echo "COMPOSE_UP_FAILED — 进入诊断模式"
  # 诊断段
  echo "=== COMPOSE LOGS ===" && docker compose logs --tail=50 2>&1
  echo "=== CONTAINER STATUS ===" && docker compose ps
  echo "=== PORT CHECK ===" && ss -tlnp | head -20
  
  # 假设1: 端口冲突
  echo "HYPOTHESIS: PORT_CONFLICT"
  ss -tlnp | grep -E ":3002|:5432|:6379"
  
  # 假设2: Dockerfile 构建失败
  echo "HYPOTHESIS: BUILD_FAILURE"
  docker compose build 2>&1 | tail -20
  
  # 假设3: 服务启动后立即崩溃
  echo "HYPOTHESIS: CRASH_LOOP"
  docker compose run --rm backend npm run dev 2>&1 | head -30 || true
fi
```

**`docker compose up -d --wait` 是主启动方式**。`--wait` 标志会等待所有服务的 healthcheck 通过才返回。如果 healthcheck 配置不完整（L1.5 架构缺陷），此命令不会超时成功。

#### 多假设诊断树

**问题：服务无法访问（HTTP连接失败）**

| 假设 | 验证方法 | 证据 |
|------|---------|------|
| 端口不对 | `grep -r "3002\|PORT\|port" package.json vite.config.* 2>/dev/null` | 取出实际端口 |
| 服务启动崩溃 | `npm run dev 2>&1` 前台运行看输出 | 崩溃堆栈 |
| 绑定到了非127.0.0.1 | `ss -tlnp \| grep node` | 实际绑定地址 |
| 启动时间不够 | `for i in 1..30; do curl...; sleep 1; done` | 30秒重试全部失败 |
| 端口被占用 | `ss -tlnp \| grep ":3002 "` | 占用进程PID |
| 防火墙/权限 | `iptables -L \| grep 3002` 或 `nc -zv 127.0.0.1 3002` | 连接拒绝 vs 超时 |

**关键原则**：你不能只试一次就说是"网络问题"。至少试3种以上方式确认确实是网络不可达。

### Phase 4: API 端点验证（通过 docker compose）

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

### Phase 5: 前端 E2E 验证 — Playwright（如有前端）

如果项目包含前端，**必须使用 Playwright CLI 进行端到端测试**，不能只做 HTTP 可达性检查。

L2 e2e.md 中的真实场景必须被 Playwright 测试覆盖。

#### 5.1 安装 Playwright

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

#### 5.2 确认前端服务容器已就绪

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

#### 5.3 运行 Playwright 测试

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

#### 5.4 Playwright 测试覆盖要求

| 要求 | 说明 |
|------|------|
| 测试目标 | 必须是 **docker compose 运行中的前端 dev 服务**（不是 mock） |
| 浏览器 | 至少 Chromium（headless 模式） |
| 场景 | 覆盖 L2 `uat-script.md` 中全部 P0 用户验收剧本，至少 2 个前端真实场景 |
| 用户流程 | 登录 → 导航 → 核心操作 → 等待反馈 → 查看结果 → 退出 |
| API 交互 | 验证前端正确调用了后端 API（检查网络请求） |
| 响应式 | 至少一种视口（1920x1080 桌面） |
| 证据 | 截图、trace、网络请求、最终状态断言必须落盘 |

#### 5.5 诊断：Playwright 测试失败

| 假设 | 验证方法 |
|------|---------|
| 前端 URL 错误 | curl $FRONTEND_URL 看是否能访问 |
| CORS 问题 | 浏览器控制台检查跨域错误 |
| API 未就绪 | 直接 curl 后端 API 检查 |
| 端口映射错误 | docker compose ps 查看前端端口 |
| Playwright 浏览器缺失 | npx playwright install --with-deps chromium |
| 测试超时 | 增加 playwright.config.ts 中的 timeout 值 |

### Phase 5.6: 系统漫游测试（Exploratory Wander Test）

> 像真实用户第一次拿到系统一样，随便逛、随便点、随便输入。
> 脚本化测试验证的是"我们想验证的"，漫游测试发现的是"我们没想过的"。

**适用范围**：有前端的项目。纯后端/API 项目豁免。

**核心定位**：Phase 5 验证已知路径，Phase 7 验证用户验收剧本，**Phase 5.6 发现未知问题**。
不是按剧本演，而是像用户一样瞎逛——很多 UI 崩溃、死链接、控制台报错、死胡同页面、表单没校验的问题，随便点几下就暴露了。

详细方法论参考：`references/exploratory-wander.md`。

#### 5.6.1 前置条件

- Phase 3 的 docker compose 服务仍在运行
- Phase 5.2 的前端可达性检查已通过（`FRONTEND_READY=true`）
- Playwright CLI 可用（已在 Phase 5.1 安装）

如果前端不可达或纯后端项目 → 跳过本 Phase，报告标注 `WANDER_SKIP: 无前端`。

#### 5.6.2 执行漫游

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
# 对每个页面检查是否有返回导航
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

#### 5.6.3 漫游证据包

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

#### 5.6.4 问题分级与阻塞策略

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

P1 问题每条必须有截图 + 修复建议。可以不够精确，但不能没有。

**P2 — 必须修复**（不阻塞 L6 PASS 但必须修复）：性能偏慢、文案不统一、响应式小瑕疵。P2 不修 = 体验不过关 = 用户会投诉。

#### 5.6.5 诊断：漫游发现问题

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

#### 5.6.6 问题追踪与修复反馈

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
- `trace_to_design` 字段：如果问题根因是设计层遗漏（如空状态没设计、导航没设计），必须标注回退层：
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

#### 5.6.7 通过标准

漫游测试 PASS 必须同时满足：
- **P0 问题数为 0**。有 P0 = L6 不能 PASS。
- **P1 问题全部修复**。不允许带着 P1 交付。
- **P2 问题全部修复**。P2 不修 = 体验不过关 = 用户会投诉。不允许跳过任何级别的问题。
- **全量覆盖**：DFS 遍历了所有导航入口可达的页面（≥ 3 层深度）。
- **证据完整**：页面地图（page-map.json）、截图集合、console 错误日志、network 错误日志全部存在。
- **issues.json 完整**：所有发现的问题（P0/P1/P2）都记录在 issues.json 中，每条有根因分析和修复建议。
- **P1 问题有修复建议**：每条 P1 都有截图、根因分析和具体修复方向。
- **P2 问题有修复建议**：每条 P2 都有截图、根因分析和具体修复方向。不允许只记录不修复。
- **设计层回退标注**：根因在设计层的问题，`trace_to_design` 字段不为空。

### Phase 6: 后端 E2E 场景验证

**核心要求：所有测试必须针对 `docker compose` 启动并正在运行的 dev 服务执行。**

不得使用独立的测试数据库启动方式（如 `npm run test:e2e -- --db standalone`），必须复用 Phase 3 启动的 dev 服务。

#### 6.1 验证 dev 服务仍在运行

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

#### 6.2 准备测试数据

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

也可通过 `docker compose exec` 直接在容器内运行数据初始化脚本。

#### 6.3 运行 E2E 测试

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

#### 6.4 E2E 测试覆盖要求

| 要求 | 说明 |
|------|------|
| 测试目标 | **docker compose 启动并正在运行的 dev 服务**（不是独立测试容器） |
| 测试数据 | 生产级数据量（≥100 条记录） |
| 场景覆盖 | L2 e2e.md 中每个核心规则至少 1 个 E2E 场景 |
| 真实场景 | 至少覆盖 L2 中 2 个多步骤真实场景 |
| 数据清理 | 测试完成后清理注入的数据（或重建测试数据库） |
| 测试结果 | 全部 GREEN 才算 E2E 通过 |

#### 6.5 诊断：E2E 测试失败

| 假设 | 验证方法 |
|------|---------|
| 服务未启动 | `docker compose ps` 检查服务状态 |
| 数据库未初始化 | `docker compose exec -T backend npm run db:migrate:status` |
| 测试数据冲突 | 检查之前测试是否有残留数据 |
| API 版本不匹配 | 对比前端请求和后端路由定义 |
| 权限不足 | 检查测试 token 是否有效 |

### Phase 7: UAT 用户验收执行（最终通过门槛）

读取 `.shadow/L2-e2e/BXX-{slug}/uat-script.md`，按真实用户路径执行验收。没有 `uat-script.md` 时，L6 不能声明最终验收通过，只能标记为 DEPLOY_PARTIAL。

### Phase 7.5: 真正可用验证（Real Usability）

引用标准：`skills/shadow-l6-deploy/references/real-usability-contract.md`。

L6 只有在以下证据都存在时才能声明 `DEPLOY_PASS`：

| 证据 | 验证要求 |
|------|----------|
| `persistence_proof` | 通过真实页面/API 创建业务数据，再通过 API/DB/列表查询到同一数据 |
| `restart_survival_proof` | 重启 backend 或 compose 服务后，同一业务数据仍可查询 |
| `auth_proof` | 真实账号登录成功，越权角色访问被拒绝 |
| `cross_service_proof` | 前端或 HTTP scenario 触发后端 API，并在真实存储中产生业务状态变化 |
| `uat_execution_proof` | P0 UAT 剧本 100% 执行，有截图、网络请求和最终数据状态证据 |

禁止把以下内容当作真正可用：
- `docker compose ps` healthy。
- `/api/health` 返回 200。
- 创建接口返回 201 但没有查询/持久化证据。
- 单元测试总数通过，如 `109 tests PASSED`。
- 使用 InMemoryRepository、mock DB、假登录路径跑通的场景。

如果缺少任一 P0 证据，结论必须是 `DEPLOY_FAIL` 或 `DEPLOY_PARTIAL`，且不得创建 L6 `.passed`。

### Phase 7.6: 生产级验收验证（Production Acceptance）

引用标准：`skills/shadow-l6-deploy/references/production-acceptance-contract.md`。

L6 必须回答：真实用户是否愿意在真实工作中依赖这个系统？必须证明真实用户可以拿真实数据完成真实工作，系统出错时可发现、可解释、可恢复、可追责。

| 闭环 | L6 必须采集的证据 |
|------|-------------------|
| 业务 | 真实角色完成 P0 主流程，不需工程师手工补步骤 |
| 数据 | 创建/处理/查询/导出/回溯一致，重启后仍可查 |
| 权限 | 登录、授权、越权拒绝、审计日志证据 |
| 状态 | pending/running/success/failure/partial/cancel/rework 等状态可解释、可恢复 |
| 异常 | 网络失败、任务失败、部分失败、重复提交、并发冲突的恢复路径 |
| UX | 用户可见的下一步、成功结果、失败原因、重试/修正入口 |
| 集成 | 前端/API → 后端 → DB/对象存储/队列/外部服务的 trace |
| 运维 | 日志、trace/request id、重试、回滚、备份或数据修复路径 |
| 性能 | 目标数据量、并发量、任务量下的 smoke/批量验收结果 |
| 证据 | 截图、network、日志、trace、DB/存储查询、导出文件路径 |

任一 P0 闭环缺失，结论不得写 `DEPLOY_PASS`；最多写 `DEPLOY_PARTIAL`，并列出回退责任层。

#### 7.1 UAT 执行方式

| 项目类型 | 执行方式 | 要求 |
|----------|----------|------|
| 有前端 | Playwright 驱动真实浏览器 | 按用户剧本点击真实页面，不直接调用内部函数，不 mock API |
| 纯后端/API | API scenario replay | 按用户剧本用真实 HTTP 请求串联业务步骤 |
| 有异步/外部服务 | API/页面 + 日志/队列/回调证据 | 验证成功路径和失败/超时/重试路径 |

#### 7.2 UAT 证据包

每条 UAT 剧本必须生成证据，保存到 `{迭代作用域}/L6-deploy/{slug}/uat-evidence/`：

```text
{迭代作用域}/L6-deploy/{slug}/uat-evidence/
  UAT-01/
    screenshots/
      01-login.png
      02-operation.png
      03-result.png
    network.json
    trace.zip
    assertions.json
    data-proof.json
    result.md
```

证据要求：
- 截图：起始页、关键操作页、最终结果页。
- 网络请求：关键 API 的 method、url、status、响应摘要。
- 数据证据：最终 API 响应、DB 查询摘要、导出文件 hash 或业务状态。
- 副作用证据：通知、事件、审计、异步任务日志。
- 失败证据：如果失败，记录用户看到的错误提示和系统恢复路径。

#### 7.3 UAT 通过标准

UAT 必须全部满足：
- P0 UAT 剧本 100% PASS。
- P1 UAT 剧本无阻塞失败；失败项必须有明确诊断和修复建议。
- 每条 PASS 剧本都有截图、网络请求、最终数据/状态证据。
- 没有跳过核心用户路径。
- 没有 mock 后端、mock 登录、mock 外部成功结果；如外部服务无法真实调用，必须用可审计的本地 fake 服务并记录证据。
- 用户可见反馈和业务最终状态都符合 L2 通过标准。
- 有持久化服务的项目，P0 UAT 必须包含重启后数据仍可查询的证据。

### Phase 8: 生成部署报告

部署报告必须包含以下内容，**缺少任何一项视为不完整**：

```markdown
# 部署报告

## 1. 环境基线
- Docker Compose: {version}
- Docker Engine: {version}
- Node (备用): {version}
- 端口状态: {port}=清空/占用(pid)
- docker-compose.yml: 存在/缺失
- docker-compose.test.yml: 存在/缺失

## 2. 启动配置
- Dockerfile: 存在/缺失
- .env: 存在/缺失
- docker compose config: 合法/非法
- 构建: PASS/FAIL（失败原因: xxx）
- 构建方式: docker compose build / 降级 npm build

## 3. 服务启动
- 启动方式: docker compose up -d --wait
- 启动耗时: x 秒
- 各服务状态: backend=healthy / db=healthy / redis=healthy
- 健康检查: PASS/FAIL
- 最后一次检查: HTTP {code}

## 4. API 验证（针对 docker compose 运行中的 dev 服务）
| 端点 | 状态 | HTTP | 备注 |
|------|------|------|------|
| /api/health | ✅/❌ | 200 | - |
| /api/projects | ✅/❌ | 200 | - |

## 5. 前端 E2E — Playwright（如有前端）
- Playwright 版本: {version}
- Chromium 已安装: YES/NO
- 测试目标: http://127.0.0.1:{frontend_port} (docker compose 运行中)
- Playwright 测试结果: PASS/FAIL / N/A(无前端)
- 覆盖场景数: {n}
- 测试报告: playwright-report/ (存在/缺失)

## 5.6 系统漫游测试（Exploratory Wander）
- 漫游起始页: {url}
- 漫游深度: {n} 层
- 发现页面数: {n}
- 截图数: {n}
- Console 错误: {n} 条
- HTTP 4xx/5xx: {n} 条
- P0 问题: {n} 个
- P1 问题: {n} 个
- 证据目录: `{迭代作用域}/L6-deploy/{slug}/wander-evidence/`

### 页面地图
| # | 页面标题 | URL | 深度 | 截图 | Console | HTTP | 状态 |
|---|---------|-----|:----:|------|:-------:|:----:|:----:|
| 1 | 首页 | / | 0 | wander-01.png | 0 | 0 | OK |

### 发现的问题
| # | 级别 | 页面 | 操作 | 现象 | 截图 | Console/Network 证据 | 根因分析 | 修复建议 |
|---|------|------|------|------|------|---------------------|---------|---------|
| （无 P0 问题时留空，但页面地图必须完整） |

## 6. 后端 E2E（针对 docker compose 运行中的 dev 服务）
- 测试目标: docker compose up -d --wait (运行中)
- 测试方法: container exec / API scenario / test profile
- 测试数据量: {n} 条
- | 场景 | 来源 (L2 e2e.md) | 结果 |
  |------|-------------------|------|
  | {场景名} | §{章节} | PASS/FAIL |
- 通过率: {n}/{m}

## 7. UAT 用户验收（按真实用户路径）
- UAT 剧本来源: `.shadow/L2-e2e/BXX-{slug}/uat-script.md`
- 执行目标: 运行中的真实服务 URL
- 证据目录: `{迭代作用域}/L6-deploy/{slug}/uat-evidence/`

| UAT | 角色 | 用户目标 | 执行方式 | 结果 | 证据 |
|-----|------|----------|----------|------|------|
| UAT-01 | 管理员 | 完成核心配置 | Playwright | PASS/FAIL | screenshots/network/trace |

## 8. 真正可用验证
- real_usability: PASS/FAIL/PARTIAL
- persistence_proof: {创建数据 + 查询数据 + DB/存储证据摘要}
- restart_survival_proof: {重启命令 + 重启后查询同一数据}
- auth_proof: {登录成功 + 越权拒绝}
- cross_service_proof: {前端/HTTP → API → DB/存储链路证据}
- uat_execution_proof: {P0 UAT 编号 + 证据路径}

## 9. 生产级验收验证
- production_acceptance: PASS/FAIL/PARTIAL
- business_closure: {真实角色 + P0 工作流 + 最终业务结果}
- data_closure: {创建/处理/查询/导出/回溯/重启保留证据}
- permission_closure: {登录/授权/越权拒绝/审计日志}
- state_closure: {处理中/成功/失败/部分失败/取消/返工状态证据}
- exception_closure: {失败/重试/部分失败/重复提交/并发冲突恢复证据}
- ux_closure: {下一步/成功结果/失败原因/修正入口截图}
- integration_closure: {前端/API→后端→DB/对象存储/队列/外部服务 trace}
- ops_closure: {日志/trace/request id/回滚/备份/数据修复路径}
- performance_closure: {目标数据量/并发量/任务量 smoke 结果}
- evidence_closure: {截图/network/log/trace/DB/导出文件证据路径}

## 10. 诊断记录（有失败时必须）
### 失败1: {端点} {错误描述}
| 假设 | 验证 | 结果 |
|------|------|------|
| 端口配置错误 | grep port → 3002 | ❌ 排除 |
| 进程崩溃 | 前台启动 → 看日志 | ✅ 确认: EADDRINUSE |
| 端口占用 | ss -tlnp → pid 1234 | ✅ 确认: 旧进程残留 |
| 解决方案 | kill 1234 && 重启 | ✅ 恢复 |
- **根因**: 端口被旧进程占用
- **解决**: kill 旧进程 + 等待 2s 后重启成功

## 11. 结论
DEPLOY_PASS / DEPLOY_FAIL / DEPLOY_PARTIAL
```

## 诊断铁律

1. **一个失败至少验证3种假设** — 单一假设直接归因视为偷懒
2. **禁止"网络问题""环境问题""沙箱隔离"等无证据归因** — 必须有具体的 `ss`/`curl`/`ps` 输出做证据
3. **失败时必须贴证据** — 不是"服务不可用"，而是 `curl 返回 code=000, timeout after 5s, ss 显示端口无人监听`
4. **N/A 不算诊断** — "Docker 不可用"不是终点，换 npm 方案继续
5. **所有临时修复必须记录** — kill 旧进程、改端口、加依赖，都要写进报告

## Phase 9: 层内自检（L6 Gate）

部署验证完成后，执行 L6 层内自检。核心是**审查部署报告的质量**，不只看结论。

### 自检清单

#### 结构性检查
1. deployment-report.md 存在 → 否则直接 FAIL
2. 报告包含 7 个章节（环境基线/启动配置/服务启动/API验证/诊断记录/E2E验证/结论）→ 缺章节 FAIL

#### 诊断质量检查（有失败时必须）
3. **每个失败有 ≥3 种假设验证记录** → 只有1-2种假设的，标记为"诊断不充分，要求补充"
4. **没有"网络问题""环境问题""沙箱限制"等无证据归因** → 出现这些词且无证据链的，**自动 FAIL**
5. **所有临时修复有记录** → 改过端口/加过依赖/kill 过进程，必须写进报告
6. **根因分析到位** → 不只是"端口被占"，而是"旧 node 进程残留 pid=1234，kill 后重启成功"
7. **证据链完整** → curl 输出、ss 输出、ps 输出、日志片段，至少有一种贴在报告中

#### 功能性检查
8. 启动配置完整（含依赖安装）
9. 健康检查通过（HTTP 200 或预期响应）
10. 关键API端点验证通过
11. L2 e2e场景至少验证核心场景
12. `uat-script.md` 存在，且部署报告逐条引用 UAT 剧本
13. P0 UAT 剧本 100% PASS；否则最终验收 FAIL
14. UAT 证据包存在，至少包含截图/网络请求/最终数据状态证据
15. 前端验收必须有截图：使用 `playwright-cli screenshot` 对每个前端页面/UAT 场景截取起始页、关键操作页、最终结果页截图；纯后端/API 无前端界面的项目可豁免
16. 真正可用验证章节存在，且 `real_usability: PASS`
17. 持久化证据存在：创建数据、查询数据、DB/存储证据闭合
18. 重启保留证据存在：服务重启后同一业务数据仍可查询
19. 认证证据存在：真实登录成功，越权访问被拒绝
20. 跨服务证据存在：前端/HTTP → API → DB/存储链路闭合
21. 生产级验收章节存在，且 `production_acceptance: PASS`
22. 漫游测试章节存在（有前端时） — 报告必须包含 Phase 5.6 漫游测试章节
23. 漫游页面地图完整 — 所有导航入口可达的页面都被访问（≥ 3 层深度），page-map.json 存在且非空
24. 漫游截图证据存在 — wander-evidence/screenshots/ 包含每个页面的截图
25. 漫游错误证据充分 — console-errors.json 和 network-errors.json 存在
26. 漫游 P0 问题有根因+修复建议 — 不能只说"有问题"，必须说清为什么和怎么修
27. 漫游无偷懒 — "漫游发现无明显问题"但没有页面地图/截图 = 打回
28. 漫游 issues.json 存在且完整 — 每条问题有 id/level/page_url/symptom/screenshot/root_cause/fix_suggestion/suggested_agent
29. 漫游设计层回退标注 — trace_to_design 字段对设计层缺失问题不为空

#### 偷懒信号识别

| 偷懒信号 | 处理 |
|---------|------|
| "N/A" 出现超过1次 | 打回 — 没有"不适用"，只有"没试" |
| 只有结论没有日志输出 | 打回 — 证据呢？ |
| "可能是……"没有"实际验证了……" | 打回 — 推测不是诊断 |
| 所有检查都是 PASS 但没有操作记录 | 打回 — 你怎么确定 PASS 的？ |
| UAT PASS 但没有截图/网络/数据证据 | 打回 — 这不是用户验收，只是口头结论 |
| 前端页面/UAT 场景没有截图 | 打回 — 前端验收必须使用 `playwright-cli screenshot` 截取起始页、关键操作、最终结果 |
| API 返回 200/201 就声明可用 | 打回 — 这只是连通性，不是业务可用 |
| 使用 InMemoryRepository / mock DB / 假登录完成 UAT | 打回 — 真实用户不能使用这种系统 |
| 只说"功能都实现了" | 打回 — 验收标准是真实工作可依赖，不是功能清单完成 |
| 漫游报告"未发现明显问题"但没有页面地图 | 打回 — 没有页面地图说明没有真的漫游 |
| 漫游只有 2-3 张截图 | 打回 — 正常系统至少 5+ 页面，2-3 张截图不叫漫游 |
| 漫游 P0 问题没有根因和修复建议 | 打回 — "有问题"不是报告，"为什么"和"怎么修"才是 |
| 漫游 console 错误数为 0 但有页面白屏 | 打回 — 错误捕获没有正确注入 |
| 漫游页面地图只有一级深度 | 打回 — DFS 至少要深入 3 层 |
| "由于时间关系只测试了部分页面" | 打回 — 全量遍历是强制要求 |
| 漫游发现 P0 但 L6 结论写 PASS | 打回 — P0 问题阻塞 L6 PASS，不可妥协 |
| 漫游发现问题但 issues.json 不存在 | 打回 — 没有问题清单说明没打算修复 |
| 漫游 P0/P1 没有 root_cause 和 fix_suggestion | 打回 — "有问题"不是报告，要能直接派 agent 修 |
| 漫游设计层缺失但 trace_to_design 为空 | 打回 — 不允许只在 L5 打补丁掩盖上游设计缺失 |

### 自检判定
- **PASS**: 全部检查项通过，P0 UAT 100% PASS，真正可用和生产级验收均 PASS 且证据完整 → 创建 `{迭代门禁目录}/l6.{slug}.passed`（门禁目录为 `.shadow/iterations/{当前迭代}/gate/`）
- **PARTIAL**: 功能有缺陷但有完整诊断记录 + 明确阻塞项 + 替代方案 → 不创建 .passed，只输出 PARTIAL 审查结论
- **FAIL**: 诊断不完整 / 偷懒信号 / 结构缺失 → 不创建 .passed，输出审查报告要求重做
