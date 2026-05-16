#!/usr/bin/env bash
set -euo pipefail

# wander-test.sh — 系统漫游测试（Exploratory Wander Test）
# 基于 Playwright CLI 的自动漫游：迭代 DFS 遍历所有可达页面，捕获错误，截图证据
#
# 用法:
#   bash skills/shadow-l6-deploy/scripts/wander-test.sh <slug> <base_url> [evidence_dir]
#
# 输出:
#   {evidence_dir}/wander-evidence/
#     page-map.json          — 页面地图
#     screenshots/           — 每个页面的截图
#     console-errors.json    — console 错误汇总
#     network-errors.json    — HTTP 4xx/5xx 汇总
#     wander-report.md       — 人类可读报告

SLUG="${1:-}"
BASE_URL="${2:-http://localhost:3000}"
EVIDENCE_DIR="${3:-}"

[ -z "$SLUG" ] && { echo "用法: $0 <slug> <base_url> [evidence_dir]"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"

if [ -z "$EVIDENCE_DIR" ]; then
  EVIDENCE_DIR="$PROJECT_DIR/.shadow/L6-deploy/$SLUG/wander-evidence"
fi

WANDER_DIR="$EVIDENCE_DIR"
SCREENSHOT_DIR="$WANDER_DIR/screenshots"
mkdir -p "$WANDER_DIR" "$SCREENSHOT_DIR"

STACK_FILE="$WANDER_DIR/.dfs-stack"
VISITED_FILE="$WANDER_DIR/.visited-urls"
COUNTER_FILE="$WANDER_DIR/.page-counter"
P0_RESULT_FILE="$WANDER_DIR/.p0-result"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PAGE_MAP_FILE="$WANDER_DIR/page-map.json"
CONSOLE_ERRORS_FILE="$WANDER_DIR/console-errors.json"
NETWORK_ERRORS_FILE="$WANDER_DIR/network-errors.json"
ISSUES_FILE="$WANDER_DIR/issues.json"
REPORT_FILE="$WANDER_DIR/wander-report.md"

echo -e "${CYAN}=== 系统漫游测试 (Exploratory Wander Test) ===${NC}"
echo "目标: $BASE_URL"
echo "证据目录: $WANDER_DIR"
echo ""

# 前置检查
command -v npx > /dev/null 2>&1 || { echo -e "${RED}npx 未找到，请先安装 Node.js${NC}"; exit 1; }

npx playwright-cli --version > /dev/null 2>&1 || {
  echo -e "${YELLOW}安装 playwright-cli...${NC}"
  npm install -g @playwright/cli@latest > /dev/null 2>&1
}

# 初始化 JSON 文件
echo '[]' > "$PAGE_MAP_FILE"
echo '[]' > "$CONSOLE_ERRORS_FILE"
echo '[]' > "$NETWORK_ERRORS_FILE"
echo '[]' > "$ISSUES_FILE"

# 初始化 DFS 状态文件
echo "0" > "$COUNTER_FILE"
: > "$VISITED_FILE"

echo -e "${CYAN}--- 层 1: 页面发现 + 全量截图 ---${NC}"
echo ""

# 检查前端是否可达
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 "$BASE_URL" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" = "000" ] || [ "$HTTP_STATUS" = "CURL_FAIL" ]; then
  echo -e "${RED}前端不可达: $BASE_URL (HTTP $HTTP_STATUS)${NC}"
  echo -e "${RED}漫游测试中止 — 请先确认前端服务已启动${NC}"
  echo "{\"status\": \"ABORTED\", \"reason\": \"frontend_unreachable\", \"url\": \"$BASE_URL\", \"http_code\": \"$HTTP_STATUS\"}" > "$WANDER_DIR/abort.json"
  exit 1
fi
echo -e "${GREEN}前端可达: HTTP $HTTP_STATUS${NC}"
echo ""

# --- Helper functions ---

inject_error_capture() {
  npx playwright-cli evaluate "
    if (!window.__wander_errors) {
      window.__wander_errors = [];
      window.__wander_network_errors = [];
      window.__wander_visited = [];
      const origError = console.error;
      console.error = function(...args) {
        window.__wander_errors.push({ type: 'console.error', message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), ts: Date.now() });
        origError.apply(console, args);
      };
      window.addEventListener('error', function(e) {
        window.__wander_errors.push({ type: 'unhandled', message: e.message, file: e.filename, line: e.lineno, ts: Date.now() });
      });
      window.addEventListener('unhandledrejection', function(e) {
        window.__wander_errors.push({ type: 'rejection', message: e.reason && e.reason.message ? e.reason.message : String(e.reason), ts: Date.now() });
      });
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const resp = await origFetch.apply(window, args);
        if (!resp.ok) {
          window.__wander_network_errors.push({ url: typeof args[0] === 'string' ? args[0] : args[0].url, status: resp.status, ts: Date.now() });
        }
        return resp;
      };
    }
  " > /dev/null 2>&1 || true
}

query_console_errors() {
  npx playwright-cli evaluate "JSON.stringify(window.__wander_errors || [])" 2>/dev/null || echo "[]"
}

query_network_errors() {
  npx playwright-cli evaluate "JSON.stringify(window.__wander_network_errors || [])" 2>/dev/null || echo "[]"
}

get_current_url() {
  npx playwright-cli evaluate "window.location.href" 2>/dev/null || echo "unknown"
}

get_page_title() {
  npx playwright-cli evaluate "document.title" 2>/dev/null || echo "untitled"
}

# --- Safe JSON helpers (data via temp files / sys.argv, no shell interpolation into Python) ---

append_to_page_map() {
  local seq="$1"
  local depth="$2"
  local data_file="$3"
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
page_map = json.load(open(sys.argv[2]))
page_map.append({
    'seq': int(sys.argv[3]),
    'title': d['title'],
    'url': d['url'],
    'requested_url': d['requested_url'],
    'depth': int(sys.argv[4]),
    'parent': d['parent'],
    'screenshot': d['screenshot'],
    'console_errors': d['console_count'],
    'network_errors': d['network_count'],
    'status': d['status']
})
with open(sys.argv[2], 'w') as f:
    json.dump(page_map, f, ensure_ascii=False, indent=2)
" "$data_file" "$PAGE_MAP_FILE" "$seq" "$depth" 2>/dev/null || true
}

append_errors_to_file() {
  local seq="$1"
  local error_key="$2"
  local data_file="$3"
  local target_file="$4"
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
seq = int(sys.argv[3])
errs = data[sys.argv[2]]
page_url = data['url']
all_errs = json.load(open(sys.argv[4]))
for e in errs:
    e['page_url'] = page_url
    e['page_seq'] = seq
all_errs.extend(errs)
with open(sys.argv[4], 'w') as f:
    json.dump(all_errs, f, ensure_ascii=False, indent=2)
" "$data_file" "$error_key" "$seq" "$target_file" 2>/dev/null || true
}

write_page_data() {
  local data_file="$1"
  shift
  python3 -c "
import json, sys
data = {
    'title': sys.argv[1],
    'url': sys.argv[2],
    'requested_url': sys.argv[3],
    'parent': sys.argv[4],
    'screenshot': sys.argv[5],
    'console_count': int(sys.argv[6]),
    'network_count': int(sys.argv[7]),
    'status': sys.argv[8]
}
with open(sys.argv[9]) as f:
    data['console_errs'] = json.load(f)
with open(sys.argv[10]) as f:
    data['network_errs'] = json.load(f)
with open(sys.argv[11], 'w') as f:
    json.dump(data, f, ensure_ascii=False)
" "$@" 2>/dev/null || true
}

# --- 执行漫游 ---

echo -e "${CYAN}开始 DFS 漫游...${NC}"
echo ""

npx playwright-cli open "$BASE_URL" > /dev/null 2>&1 || {
  echo -e "${RED}无法打开浏览器，Playwright 可能未正确安装${NC}"
  echo -e "${YELLOW}尝试: npx playwright install --with-deps chromium${NC}"
  exit 1
}

sleep 3

# 初始 URL 入栈: depth<tab>parent<tab>url
printf "0\tSTART\t%s\n" "$BASE_URL" > "$STACK_FILE"

ERROR_INJECT_DONE=""

# --- 迭代 DFS（用文件持久化状态，无 subshell 变量丢失） ---
while [ -s "$STACK_FILE" ]; do
  # 弹出栈顶（DFS LIFO）
  current=$(tail -n 1 "$STACK_FILE")
  sed -i '$ d' "$STACK_FILE"

  # 解析: depth<tab>parent<tab>url
  IFS=$'\t' read -r depth parent url <<< "$current"

  # 去重
  if grep -qFx "$url" "$VISITED_FILE" 2>/dev/null; then
    continue
  fi
  echo "$url" >> "$VISITED_FILE"

  # 递增计数器（文件持久化）
  counter=$(($(cat "$COUNTER_FILE") + 1))
  echo "$counter" > "$COUNTER_FILE"

  seq=$(printf "%02d" "$counter")
  screenshot_name="wander-${seq}.png"
  screenshot_path="$SCREENSHOT_DIR/$screenshot_name"

  echo -e "  ${CYAN}→ [$seq] 深度=$depth 访问: $url${NC}"

  # 导航到页面
  npx playwright-cli goto "$url" > /dev/null 2>&1 || true
  sleep 2

  # 注入错误捕获（首次）
  if [ -z "$ERROR_INJECT_DONE" ]; then
    inject_error_capture
    ERROR_INJECT_DONE="yes"
  fi

  # 截图（默认态）
  npx playwright-cli screenshot > "$screenshot_path" 2>/dev/null || true

  # 截图（桌面宽 1920x1080）
  desktop_screenshot_name="wander-${seq}-desktop.png"
  npx playwright-cli evaluate "
    window.resizeTo && window.resizeTo(1920, 1080);
  " > /dev/null 2>&1 || true
  npx playwright-cli screenshot --viewport-size="1920,1080" > "$SCREENSHOT_DIR/$desktop_screenshot_name" 2>/dev/null || true

  # 获取页面信息
  title=$(get_page_title)
  current_url=$(get_current_url)

  # 收集错误 → 写入临时文件（避免 Python 字符串注入）
  console_errs=$(query_console_errors)
  console_count=$(echo "$console_errs" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "0")

  network_errs=$(query_network_errors)
  network_count=$(echo "$network_errs" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "0")

  # 状态判定
  status="OK"
  [ "$console_count" -gt 0 ] && status="WARN"
  [ "$network_count" -gt 0 ] && status="WARN"
  [ "$console_count" -gt 3 ] && status="ERROR"
  [ "$network_count" -gt 2 ] && status="ERROR"

  # 将错误 JSON 写入临时文件，通过文件传递给 Python（Bug 4 修复）
  console_tmp=$(mktemp "$WANDER_DIR/.console-errs-XXXXXX.json")
  network_tmp=$(mktemp "$WANDER_DIR/.network-errs-XXXXXX.json")
  printf '%s' "$console_errs" > "$console_tmp"
  printf '%s' "$network_errs" > "$network_tmp"

  page_data_file=$(mktemp "$WANDER_DIR/.page-data-XXXXXX.json")
  write_page_data "$page_data_file" \
    "$title" "$current_url" "$url" "$parent" "$screenshot_name" \
    "$console_count" "$network_count" "$status" \
    "$console_tmp" "$network_tmp" "$page_data_file"

  rm -f "$console_tmp" "$network_tmp"

  # 追加到页面地图
  append_to_page_map "$seq" "$depth" "$page_data_file"

  echo -e "    标题: $title | Console: $console_count | Network: $network_count | 状态: $status"

  # 记录错误详情
  if [ "$console_count" -gt 0 ]; then
    append_errors_to_file "$seq" "console_errs" "$page_data_file" "$CONSOLE_ERRORS_FILE"
  fi

  if [ "$network_count" -gt 0 ]; then
    append_errors_to_file "$seq" "network_errs" "$page_data_file" "$NETWORK_ERRORS_FILE"
  fi

  rm -f "$page_data_file"

  # --- 按钮探测（在当前页面上操作，先于子链接，避免 Bug 7） ---
  echo -e "    ${CYAN}探测非链接交互元素...${NC}"
  buttons_json=$(npx playwright-cli evaluate "
    JSON.stringify(
      Array.from(document.querySelectorAll('button:not([disabled]), [role=tab]:not([disabled]), [role=button]:not([disabled])'))
        .filter(b => !b.closest('form'))
        .map((b, i) => ({ index: i, text: b.textContent.trim().substring(0, 30), tag: b.tagName }))
        .slice(0, 10)
    )
  " 2>/dev/null || echo "[]")

  btn_count=$(echo "$buttons_json" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "0")

  if [ "$btn_count" -gt 0 ] && [ "$btn_count" -le 10 ]; then
    echo -e "    发现 $btn_count 个可点击按钮，逐个尝试..."

    # Bug 8 修复：用 python3 获取毫秒时间戳
    click_ts=$(python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null || echo "0")

    for i in $(seq 0 $((btn_count - 1))); do
      counter=$(($(cat "$COUNTER_FILE") + 1))
      echo "$counter" > "$COUNTER_FILE"

      bseq=$(printf "%02d" "$counter")

      # 操作前截图
      before_shot="$SCREENSHOT_DIR/wander-${bseq}-btn${i}-before.png"
      npx playwright-cli screenshot > "$before_shot" 2>/dev/null || true

      # 操作后截图
      bshot="$SCREENSHOT_DIR/wander-${bseq}-btn${i}-after.png"

      npx playwright-cli evaluate "
        var btns = document.querySelectorAll('button:not([disabled]), [role=tab]:not([disabled])');
        if (btns[$i]) btns[$i].click();
      " > /dev/null 2>&1 || true

      sleep 1
      npx playwright-cli screenshot > "$bshot" 2>/dev/null || true

      b_console=$(query_console_errors)
      # 将 click_ts 和 JSON 通过临时文件传递，避免 shell 插值
      bcc_tmp=$(mktemp "$WANDER_DIR/.bcc-XXXXXX.json")
      printf '%s' "$b_console" > "$bcc_tmp"
      b_cc=$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
ts = int(sys.argv[2])
print(len([e for e in d if e.get('ts', 0) > ts]))
" "$bcc_tmp" "$click_ts" 2>/dev/null || echo "0")
      rm -f "$bcc_tmp"

      if [ "$b_cc" -gt 0 ]; then
        echo -e "    ${RED}按钮 #$i 点击后产生 $b_cc 个新 console 错误${NC}"
      fi
    done
  fi

  # 按钮点击可能导航离开，回到当前页面后再提取子链接
  npx playwright-cli goto "$url" > /dev/null 2>&1 || true

  # --- 最大深度控制 ---
  if [ "$depth" -ge 5 ]; then
    echo -e "    ${YELLOW}达到最大深度 5，停止深入${NC}"
    continue
  fi

  # --- 提取子链接，推入栈 ---
  links_json=$(npx playwright-cli evaluate "
    JSON.stringify(
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 50) }))
        .filter(l => l.href.startsWith('$BASE_URL') && !l.href.includes('#') && l.href !== '$url')
        .slice(0, 20)
    )
  " 2>/dev/null || echo "[]")

  link_count=$(echo "$links_json" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "0")
  echo -e "    发现 $link_count 个子链接"

  if [ "$link_count" -gt 0 ]; then
    # 用 reversed 输出保证 DFS 顺序自然（先发现的先访问）
    child_urls_tmp=$(mktemp "$WANDER_DIR/.child-urls-XXXXXX.txt")
    echo "$links_json" | python3 -c "
import sys, json
links = json.loads(sys.stdin.read())
for l in reversed(links):
    print(l['href'])
" > "$child_urls_tmp" 2>/dev/null || true

    # process substitution 避免 subshell（Bug 1/2 修复）
    while IFS= read -r child_url; do
      if [ -n "$child_url" ]; then
        printf "%d\t%s\t%s\n" "$((depth + 1))" "$url" "$child_url" >> "$STACK_FILE"
      fi
    done < "$child_urls_tmp"

    rm -f "$child_urls_tmp"
  fi
done

# --- 层 3: 表单胡搞 ---
echo ""
echo -e "${CYAN}--- 层 3: 表单胡搞 ---${NC}"
echo ""

FORM_RESULTS="$WANDER_DIR/form-results.json"
echo '[]' > "$FORM_RESULTS"

# Bug 3 修复：用 while read + process substitution 替代 for-in，
# 并且不使用 local（此处不在函数内）
while IFS= read -r page_json; do
  [ -z "$page_json" ] && continue
  page_url=$(echo "$page_json" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['url'])" 2>/dev/null || continue)
  page_seq=$(echo "$page_json" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['seq'])" 2>/dev/null || continue)

  npx playwright-cli goto "$page_url" > /dev/null 2>&1 || continue
  sleep 2

  form_info=$(npx playwright-cli evaluate "
    JSON.stringify(
      Array.from(document.querySelectorAll('form')).map((form, fi) => ({
        index: fi,
        action: form.action,
        method: form.method,
        inputs: Array.from(form.querySelectorAll('input,textarea,select')).map(el => ({
          name: el.name || el.id || '(unnamed)',
          type: el.type || el.tagName.toLowerCase(),
          required: el.required,
          ref: el.id || el.name
        }))
      }))
    )
  " 2>/dev/null || echo "[]")

  form_count=$(echo "$form_info" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "0")

  if [ "$form_count" -gt 0 ]; then
    echo -e "  ${CYAN}页面 $page_url 有 $form_count 个表单，开始异常输入测试...${NC}"

    for fi in $(seq 0 $((form_count - 1))); do
      echo -e "    表单 #$fi 测试中..."

      # 表单初始态截图
      counter=$(($(cat "$COUNTER_FILE") + 1))
      echo "$counter" > "$COUNTER_FILE"
      eseq=$(printf "%02d" "$counter")
      npx playwright-cli screenshot > "$SCREENSHOT_DIR/wander-${eseq}-form${fi}-initial.png" 2>/dev/null || true

      # 测试 1: 空值提交
      npx playwright-cli evaluate "
        var form = document.querySelectorAll('form')[$fi];
        form.querySelectorAll('input,textarea').forEach(el => { el.value = ''; });
      " > /dev/null 2>&1 || true

      npx playwright-cli evaluate "
        var form = document.querySelectorAll('form')[$fi];
        var submitBtn = form.querySelector('[type=submit],button') || form.querySelector('button');
        if (submitBtn) submitBtn.click();
      " > /dev/null 2>&1 || true

      sleep 1
      counter=$(($(cat "$COUNTER_FILE") + 1))
      echo "$counter" > "$COUNTER_FILE"
      eseq=$(printf "%02d" "$counter")
      npx playwright-cli screenshot > "$SCREENSHOT_DIR/wander-${eseq}-form${fi}-empty.png" 2>/dev/null || true

      # 测试 2: 特殊字符（先截填充前，再填充，再截填充后，再提交）
      counter=$(($(cat "$COUNTER_FILE") + 1))
      echo "$counter" > "$COUNTER_FILE"
      eseq=$(printf "%02d" "$counter")
      npx playwright-cli screenshot > "$SCREENSHOT_DIR/wander-${eseq}-form${fi}-before-xss.png" 2>/dev/null || true

      npx playwright-cli evaluate "
        var form = document.querySelectorAll('form')[$fi];
        form.querySelectorAll('input[type=text],input[type=search],textarea').forEach(el => {
          el.value = '<script>alert(1)</script>';
          el.dispatchEvent(new Event('input', {bubbles:true}));
        });
      " > /dev/null 2>&1 || true

      npx playwright-cli evaluate "
        var form = document.querySelectorAll('form')[$fi];
        var submitBtn = form.querySelector('[type=submit],button') || form.querySelector('button');
        if (submitBtn) submitBtn.click();
      " > /dev/null 2>&1 || true

      sleep 1
      counter=$(($(cat "$COUNTER_FILE") + 1))
      echo "$counter" > "$COUNTER_FILE"
      eseq=$(printf "%02d" "$counter")
      npx playwright-cli screenshot > "$SCREENSHOT_DIR/wander-${eseq}-form${fi}-xss.png" 2>/dev/null || true

      echo -e "    ${GREEN}表单 #$fi 测试完成${NC}"
    done
  fi
done < <(python3 -c "
import json
pages = json.load(open('$PAGE_MAP_FILE'))
for p in pages:
    print(json.dumps(p))
" 2>/dev/null)

# --- 生成报告 ---
echo ""
echo -e "${CYAN}--- 生成漫游报告 ---${NC}"

# Bug 5 修复：export WANDER_DIR 使 Python heredoc 可读
export WANDER_DIR

# Bug 6 修复：Python 将 p0_count 写入文件，bash 读回
python3 << 'REPORT_SCRIPT' || true
import json, os

wander_dir = os.environ.get('WANDER_DIR', '')
page_map = json.load(open(os.path.join(wander_dir, 'page-map.json')))
console_errors = json.load(open(os.path.join(wander_dir, 'console-errors.json')))
network_errors = json.load(open(os.path.join(wander_dir, 'network-errors.json')))

total_pages = len(page_map)
total_screenshots = len([f for f in os.listdir(os.path.join(wander_dir, 'screenshots')) if f.endswith('.png')])
console_count = len(console_errors)
network_count = len(network_errors)

# 截图完整性检查
small_screenshots = []
ss_dir = os.path.join(wander_dir, 'screenshots')
for f in os.listdir(ss_dir):
    if f.endswith('.png'):
        fpath = os.path.join(ss_dir, f)
        if os.path.getsize(fpath) < 10240:
            small_screenshots.append(f)

screenshot_health = "PASS" if not small_screenshots else "FAIL"

p0_count = 0
p1_count = 0

for p in page_map:
    if p.get('status') == 'ERROR':
        p0_count += 1
    elif p.get('status') == 'WARN':
        p1_count += 1

report = f"""# 系统漫游测试报告

## 漫游概况

| 指标 | 值 |
|------|-----|
| 起始页 | {page_map[0]['requested_url'] if page_map else 'N/A'} |
| 漫游深度 | {max(p['depth'] for p in page_map) if page_map else 0} 层 |
| 发现页面数 | {total_pages} |
| 截图数 | {total_screenshots} |
| Console 错误 | {console_count} 条 |
| HTTP 4xx/5xx | {network_count} 条 |
| P0 问题 | {p0_count} 个 |
| P1 问题 | {p1_count} 个 |

## 页面地图

| # | 页面标题 | URL | 深度 | 截图 | Console | HTTP | 状态 |
|---|---------|-----|:----:|------|:-------:|:----:|:----:|
"""

for p in page_map:
    status_icon = {'OK': 'OK', 'WARN': 'WARN', 'ERROR': 'ERROR'}.get(p['status'], '?')
    report += f"| {p['seq']} | {p['title'][:30]} | {p['url'][:50]} | {p['depth']} | {p['screenshot']} | {p['console_errors']} | {p['network_errors']} | {status_icon} |\n"

if console_errors:
    report += "\n## Console 错误详情\n\n"
    for e in console_errors:
        page_url = e.get('page_url', 'unknown')
        msg = e.get('message', '')[:100]
        etype = e.get('type', 'unknown')
        report += f"- **[{etype}]** 页面 `{page_url}`: `{msg}`\n"

if network_errors:
    report += "\n## HTTP 错误详情\n\n"
    for e in network_errors:
        page_url = e.get('page_url', 'unknown')
        url = e.get('url', '')[:80]
        status = e.get('status', '?')
        report += f"- **HTTP {status}** 页面 `{page_url}` → `{url}`\n"

report += f"""
## 截图完整性

| 指标 | 值 |
|------|-----|
| 截图总数 | {total_screenshots} |
| 页面数 | {total_pages} |
| 小于 10KB 的截图 | {len(small_screenshots)} |
| 截图健康度 | {screenshot_health} |

"""
if small_screenshots:
    report += "### 异常截图（< 10KB，疑似白屏）\n\n"
    for f in small_screenshots:
        fpath = os.path.join(ss_dir, f)
        size = os.path.getsize(fpath)
        report += f"- `{f}` — {size} bytes\n"
    report += "\n"

report += f"""
## 结论

漫游测试覆盖 {total_pages} 个页面，发现 {p0_count} 个 P0 问题和 {p1_count} 个 P1 问题。

{"**P0 问题存在，L6 不能 PASS。**" if p0_count > 0 else "无 P0 阻塞问题。"}

{"**截图完整性 FAIL: " + str(len(small_screenshots)) + " 张截图小于 10KB（疑似白屏），必须重新截图。**" if small_screenshots else "截图完整性 PASS: 所有截图 >= 10KB。"}
"""

with open(os.path.join(wander_dir, 'wander-report.md'), 'w') as f:
    f.write(report)

# Bug 6 修复：将 p0_count 写入文件供 bash 读取
p0_file = os.path.join(wander_dir, '.p0-result')
with open(p0_file, 'w') as f:
    f.write(str(p0_count))

print(f"报告已生成: {os.path.join(wander_dir, 'wander-report.md')}")
REPORT_SCRIPT

# 关闭浏览器
npx playwright-cli close > /dev/null 2>&1 || true

# 从文件读取最终计数
PAGE_COUNTER=$(cat "$COUNTER_FILE")
p0_count=$(cat "$P0_RESULT_FILE" 2>/dev/null || echo "0")

# 清理临时状态文件
rm -f "$STACK_FILE" "$VISITED_FILE" "$COUNTER_FILE" "$P0_RESULT_FILE"

echo ""
echo -e "${GREEN}=== 漫游测试完成 ===${NC}"
echo "页面数: $PAGE_COUNTER"
echo "证据目录: $WANDER_DIR"
echo ""

if [ "$p0_count" -gt 0 ] 2>/dev/null; then
  echo -e "${RED}发现 P0 问题，请查看报告: $WANDER_DIR/wander-report.md${NC}"
  exit 1
fi

# 截图完整性检查
small_count=$(find "$SCREENSHOT_DIR" -name "*.png" -size -10k 2>/dev/null | wc -l || echo "0")
if [ "$small_count" -gt 0 ] 2>/dev/null; then
  echo -e "${RED}截图完整性 FAIL: $small_count 张截图小于 10KB（疑似白屏），必须重新截图${NC}"
  exit 1
fi

if [ "$PAGE_COUNTER" -eq 0 ] 2>/dev/null; then
  echo -e "${RED}漫游 FAIL: 未发现任何页面${NC}"
  exit 1
fi

echo -e "${GREEN}未发现 P0 阻塞问题，截图完整性 PASS${NC}"
exit 0
