#!/usr/bin/env bash
# smoke-scaffold-docker.sh — scaffold ↔ docker-helper 集成烟雾测试
# 验证: (1) probe-registry.sh 在 GFW 区域正确返回 exit 1
#       (2) scaffold SKILL.md 包含 docker-helper 引用 + Step 3.5 强制条款
#       (3) docker-helper SKILL.md 包含 scaffold 反向引用
# 一次性脚本, 验证完可删. 见 .claude/plans/eager-brewing-oasis.md § 验证.
#
# 用法: bash skills/smoke-scaffold-docker.sh
# 退出码: 0 = 全 PASS, 1 = 有 FAIL, 2 = 环境异常

set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCAFFOLD="$REPO/skills/shadow-scaffold/SKILL.md"
HELPER="$REPO/skills/docker-helper/SKILL.md"
PROBE="$REPO/skills/docker-helper/scripts/probe-registry.sh"

pass=0
fail=0
failures=()

check() {
    local name="$1"
    local ok="$2"
    local detail="${3:-}"
    if [[ "$ok" == "1" ]]; then
        echo "  PASS  $name"
        pass=$((pass+1))
    else
        echo "  FAIL  $name  $detail"
        fail=$((fail+1))
        failures+=("$name: $detail")
    fi
}

echo "=== scaffold ↔ docker-helper 集成烟雾测试 ==="
echo ""

# ────────────────────────────────────────────────────────────
# 1) probe-registry.sh 探测脚本
# ────────────────────────────────────────────────────────────
echo "[1] probe-registry.sh"

# 1.a 文件存在
check "1.a probe 脚本存在" "$([[ -x "$PROBE" ]] && echo 1 || echo 0)" \
    "expected: $PROBE (executable)"

# 1.b 跑一次, 退出码 0/1/2/3 都算"脚本可跑"
OUTPUT=$(bash "$PROBE" 2>&1)
PROBE_EXIT=$?
check "1.b probe 脚本能跑 (exit 实际=$PROBE_EXIT)" \
    "$([[ $PROBE_EXIT -ge 0 && $PROBE_EXIT -le 3 ]] && echo 1 || echo 0)" \
    "exit code 应在 0/1/2/3"

# 1.c 输出含 "决策" 行
check "1.c 输出含决策行" "$(echo "$OUTPUT" | grep -qE '决策:' && echo 1 || echo 0)" \
    "expected output line: '决策: ...'"

# 1.d 此环境应 GFW (docker.io 阻断, docker.1ms.run 可达) → exit 1
# (这个不强求, 因为 env 可能在海外. 只在 GFW 区域要求 exit 1)
if echo "$OUTPUT" | grep -q "docker.io.*FAIL" && echo "$OUTPUT" | grep -q "docker.1ms.run.*OK"; then
    check "1.d GFW 区域识别正确 (exit=1)" "$([[ $PROBE_EXIT -eq 1 ]] && echo 1 || echo 0)" \
        "GFW 区域应返回 exit 1"
    check "1.e 提示装 docker-helper" "$(echo "$OUTPUT" | grep -q '装 docker-helper' && echo 1 || echo 0)" \
        "GFW 时输出应含'装 docker-helper'"
else
    echo "  SKIP  1.d-e (此环境非 GFW 区域, exit=$PROBE_EXIT)"
fi
echo ""

# ────────────────────────────────────────────────────────────
# 2) scaffold SKILL.md 包含 docker-helper 引用
# ────────────────────────────────────────────────────────────
echo "[2] scaffold → docker-helper 引用"

check "2.a scaffold SKILL.md 存在" "$([[ -f "$SCAFFOLD" ]] && echo 1 || echo 0)"
check "2.b 顶部关联 skill 块存在" "$(grep -q '关联 Skill.*docker-helper' "$SCAFFOLD" && echo 1 || echo 0)"
check "2.c 引用 probe-registry.sh 路径" "$(grep -q 'probe-registry.sh' "$SCAFFOLD" && echo 1 || echo 0)"
check "2.d Step 3.5 标题存在" "$(grep -q 'Step 3.5.*网络可达性' "$SCAFFOLD" && echo 1 || echo 0)"
check "2.e 强制条款 (不允许跳步)" "$(grep -qE '强制先装.*docker-helper|强制加载本 skill' "$SCAFFOLD" && echo 1 || echo 0)"
check "2.f 决策表 4 个退出码" \
    "$(grep -cE '^\| [0-3] \|' "$SCAFFOLD" | awk '{ print ($1 >= 4) ? 1 : 0 }')" \
    "expected ≥ 4 行 (0/1/2/3 各一行)"
echo ""

# ────────────────────────────────────────────────────────────
# 3) docker-helper SKILL.md 反向引用 scaffold
# ────────────────────────────────────────────────────────────
echo "[3] docker-helper → scaffold 引用"

check "3.a docker-helper SKILL.md 存在" "$([[ -f "$HELPER" ]] && echo 1 || echo 0)"
check "3.b 顶部 '何时自动加载' 块" "$(grep -q '何时自动加载' "$HELPER" && echo 1 || echo 0)"
check "3.c 引用 shadow-scaffold" "$(grep -q 'shadow-scaffold' "$HELPER" && echo 1 || echo 0)"
check "3.d 引用 probe-registry.sh" "$(grep -q 'probe-registry.sh' "$HELPER" && echo 1 || echo 0)"
check "3.e Step 3.5 强制触发描述" "$(grep -q 'Step 3.5' "$HELPER" && echo 1 || echo 0)"
echo ""

# ────────────────────────────────────────────────────────────
# 总结
# ────────────────────────────────────────────────────────────
echo "=== 总结: $pass PASS, $fail FAIL ==="
if [[ $fail -gt 0 ]]; then
    echo ""
    echo "失败项:"
    for f in "${failures[@]}"; do
        echo "  - $f"
    done
    exit 1
fi
exit 0
