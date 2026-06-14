---
name: xdd-coverage-monitor
description: 实时监控覆盖率 — 闸门接近 95% 时主动告警, 跑前 1 分钟 dry-run 提前暴露风险.
  周期: Task 完成后 / Commit 时 / 用户问"现在进度怎样"时触发.
  输出: .xdd/reports/coverage-snapshot.md 含 6 闸门实时数据 + 风险点 + 修复建议.
  触发: 进度监控、coverage 监控、95% 告警、闸门预警、进度查询、覆盖率、coverage、monitor、watch.
---

# xdd-coverage-monitor — 实时覆盖率监控

## 目的

闸门 95% 阈值, 跑前不知道差多少, 等到收尾才发现覆盖率 60% → 全返工. **dry-run 提前 1 分钟暴露风险**, 让 phase-executor 早补.

**为什么需要这个 skill**: 95% 闸门硬, 但"现在离 95% 还差多少" 不直观. 这个 skill = 6 闸门实时 dashboard + 修复路径.

## 输入

| 输入 | 默认 | 说明 |
|------|------|------|
| 模式 | `snapshot` | `snapshot` (一次性) / `watch` (持续 5min 间隔) / `preflight` (commit 前) |
| 阈值 | `0.95` | env `XDD_COVERAGE_THRESHOLD` 覆盖 |

## 流程 (5 步)

### Step 1: 收集数据 (复用 coverage-check hook 逻辑)

```bash
THRESHOLD="${XDD_COVERAGE_THRESHOLD:-0.95}"
XDD_DIR=".xdd"
[[ -d "$XDD_DIR" ]] || { echo "❌ 无 .xdd/"; exit 1; }

# 6 闸门数据收集 (简化版, 复用 hook 的 grep 模式)
collect() {
    local name="$1"
    local total="$2"
    local done="$3"

    if [[ $total -gt 0 ]]; then
        local ratio=$(awk -v d="$done" -v t="$total" 'BEGIN{printf "%.4f", d/t}')
        local pct=$(awk -v r="$ratio" 'BEGIN{printf "%.1f", r*100}')
        local threshold_pct=$(awk -v t="$THRESHOLD" 'BEGIN{printf "%.1f", t*100}')
        local status="✅"
        awk -v r="$ratio" -v t="$THRESHOLD" 'BEGIN{exit !(r >= t)}' || status="❌"
        local gap=""
        if [[ "$status" == "❌" ]]; then
            local need=$(awk -v t="$total" -v th="$THRESHOLD" 'BEGIN{printf "%d", t*th - (t*th%1<0.5?int(t*th):int(t*th)+1)+0}')
            need=$(awk -v t="$total" -v th="$THRESHOLD" 'BEGIN{printf "%d", t*th}')
            need=$((need - done))
            [[ $need -lt 0 ]] && need=0
            gap=" [缺 $need]"
        fi
        echo "$status $name: $done/$total (${pct}%, 阈值 ${threshold_pct}%)$gap"
    else
        echo "⏸ $name: 无数据 (上游未产出)"
    fi
}
```

### Step 2: 6 闸门逐一跑

```bash
# 闸门 1: BDD RXX 覆盖率
bdd_rxx_total=$(find $XDD_DIR/bdd -name "*.md" -o -name "*.feature" 2>/dev/null | xargs grep -ohE 'R[0-9]{2,}' 2>/dev/null | sort -u | wc -l)
bdd_rxx_done=$(find apps -name "*.py" -o -name "*.ts" -o -name "*.js" -o -name "*.go" 2>/dev/null | xargs grep -ohE '@implements R[0-9]{2,}' 2>/dev/null | sort -u | wc -l)

# 闸门 2: API 端点覆盖率
arch_endpoints=$(grep -cE '\| `/api/' $XDD_DIR/arch/architecture.md 2>/dev/null || echo 0)
code_endpoints=$(find apps -name "*.py" -o -name "*.ts" -o -name "*.js" -o -name "*.go" 2>/dev/null | xargs grep -hE '@(app|router)\.(get|post|put|delete|patch)' 2>/dev/null | grep -oE '/api/[^"'\'',)]*' | sort -u | wc -l)

# 闸门 3: e2e 测试数
e2e_tests=$(find tests/e2e -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | wc -l)

# 闸门 4: 真实持久化 (mock 反向)
total_repos=$(find apps -name "*.py" -o -name "*.ts" 2>/dev/null | xargs grep -lE 'class.*Repository' 2>/dev/null | wc -l)
mock_repos=$(find apps -name "*.py" -o -name "*.ts" 2>/dev/null | xargs grep -lE 'InMemoryRepository|MockRepository' 2>/dev/null | wc -l)
real_repos=$((total_repos - mock_repos))

# 闸门 5: 跨服务 BXX
bxx_total=$(find $XDD_DIR/business -name "BXX-*.md" 2>/dev/null | wc -l)
bxx_with_e2e=$(grep -lE "e2e.*B[0-9]{2}" tests/e2e/ -r 2>/dev/null | wc -l)

# 闸门 6: stub
stub_count=$(find apps -name "*.py" -o -name "*.ts" 2>/dev/null | xargs grep -cE 'TODO|NotImplementedError|InMemoryRepository|^\s*pass\s*$' 2>/dev/null | awk -F: '{s+=$2} END{print s}')
```

### Step 3: 输出 snapshot 报告

```bash
REPORT="$XDD_DIR/reports/coverage-snapshot-$(date +%Y%m%d-%H%M%S).md"
mkdir -p $XDD_DIR/reports

cat > "$REPORT" <<EOF
# 覆盖率 Snapshot

**时间**: $(date -Iseconds)
**项目**: $(basename $(pwd))
**阈值**: ${THRESHOLD} ($(awk -v t="$THRESHOLD" 'BEGIN{printf "%.0f", t*100}')%)

## 6 闸门实时

| 闸门 | 状态 | 数据 |
|------|------|------|
| 1. BDD 覆盖率 | $(collect "BDD" $bdd_rxx_total $bdd_rxx_done | head -1 | awk '{print $1}') | $bdd_rxx_done / $bdd_rxx_total |
| 2. API 端点 | $(collect "API" $arch_endpoints $code_endpoints | head -1 | awk '{print $1}') | $code_endpoints / $arch_endpoints |
| 3. e2e 测试 | $(collect "e2e" $bdd_rxx_total $e2e_tests | head -1 | awk '{print $1}') | $e2e_tests / $bdd_rxx_total (RXX 基准) |
| 4. 真实持久化 | $(collect "Persistence" $total_repos $real_repos | head -1 | awk '{print $1}') | $real_repos / $total_repos (mock $mock_repos) |
| 5. 跨服务 BXX | $(collect "CrossBiz" $bxx_total $bxx_with_e2e | head -1 | awk '{print $1}') | $bxx_with_e2e / $bxx_total |
| 6. 0 stub | $([[ $stub_count -eq 0 ]] && echo "✅" || echo "❌") | $stub_count stub 命中 |

## 详细

\`\`\`
$(collect "1. BDD" $bdd_rxx_total $bdd_rxx_done)
$(collect "2. API" $arch_endpoints $code_endpoints)
$(collect "3. e2e" $bdd_rxx_total $e2e_tests)
$(collect "4. Persistence" $total_repos $real_repos)
$(collect "5. CrossBiz" $bxx_total $bxx_with_e2e)
[[ $stub_count -eq 0 ]] && echo "✅ 6. 0 stub" || echo "❌ 6. stub: $stub_count 命中"
\`\`\`

## 🚨 风险点 + 修复建议

$(if [[ $bdd_rxx_done -lt $(awk -v t="$bdd_rxx_total" -v th="$THRESHOLD" 'BEGIN{print int(t*th)}') ]]; then
    need=$(awk -v t="$bdd_rxx_total" -v th="$THRESHOLD" 'BEGIN{print int(t*th)}')
    echo "- **BDD 缺 $(($need - $bdd_rxx_done)) 个 RXX 实施**: 找 spec.md 列 RXX, 看哪些没 @implements"
fi)

$(if [[ $code_endpoints -lt $(awk -v t="$arch_endpoints" -v th="$THRESHOLD" 'BEGIN{print int(t*th)}') ]]; then
    need=$(awk -v t="$arch_endpoints" -v th="$THRESHOLD" 'BEGIN{print int(t*th)}')
    echo "- **API 缺 $(($need - $code_endpoints)) 个端点**: 从 arch.md 表格读, 看哪些没 @app.get/post"
fi)

$(if [[ $stub_count -gt 0 ]]; then
    echo "- **stub $stub_count 处**: grep apps/ 找 TODO/NotImplementedError/InMemoryRepository, 替换为真实现"
fi)

$(if [[ $bxx_with_e2e -lt $(awk -v t="$bxx_total" -v th="$THRESHOLD" 'BEGIN{print int(t*th)}') ]]; then
    echo "- **跨服务 BXX 缺 e2e**: 每个 BXX 业务线至少 1 个 e2e/test_*.py"
fi)

EOF

echo "[xdd] ✓ snapshot: $REPORT"
cat "$REPORT"
```

### Step 4: preflight 模式 (commit 前)

```bash
if [[ "${1:-snapshot}" == "preflight" ]]; then
    echo ""
    echo "=== Preflight 闸门预测 ==="
    fail=0
    [[ $bdd_rxx_done -lt $(awk -v t="$bdd_rxx_total" -v th="$THRESHOLD" 'BEGIN{print int(t*th)}') ]] && { echo "❌ BDD 闸门将失败"; fail=1; }
    [[ $code_endpoints -lt $(awk -v t="$arch_endpoints" -v th="$THRESHOLD" 'BEGIN{print int(t*th)}') ]] && { echo "❌ API 闸门将失败"; fail=1; }
    [[ $stub_count -gt 0 ]] && { echo "❌ stub 闸门将失败 ($stub_count)"; fail=1; }

    if [[ $fail -eq 0 ]]; then
        echo "✅ Preflight: 6 闸门预测全过, 可安全 commit"
        exit 0
    else
        echo "⚠️  Preflight: 至少 1 闸门将失败, 建议先修再 commit"
        exit 2
    fi
fi
```

### Step 5: watch 模式 (持续监控)

```bash
if [[ "${1:-snapshot}" == "watch" ]]; then
    INTERVAL="${XDD_WATCH_INTERVAL:-300}"  # 5min
    echo "[xdd] watch mode, 间隔 ${INTERVAL}s, Ctrl+C 停止"
    while true; do
        clear
        echo "=== $(date) ==="
        # 重新跑 Step 1-3 输出
        ...
        sleep "$INTERVAL"
    done
fi
```

## 何时用

- ✅ 跑完 1 个 Task 后 (snapshot)
- ✅ commit 前 (preflight) — 提前 1 分钟预测闸门
- ✅ 周期 5-10 min (watch) — Phase 5 中段
- ✅ 用户问"现在进度"时 (snapshot)

## 配合

- `xdd-gate-coverage-check` — 跑正式闸门 (exit code)
- `xdd-gate-stub-scan` — stub 0 容忍检查
- `xdd-status` — 整体 Phase 状态
- `xdd-halt` — 闸门失败时 HALT 升级

## 反模式

- ❌ 不用来代替正式闸门 (snapshot 是"提示", coverage-check 是"硬卡")
- ❌ 不用来掩饰问题 (snapshot 必须诚实, 不准"基本通过")
- ❌ watch 模式不要 < 60s 间隔 (性能开销)
