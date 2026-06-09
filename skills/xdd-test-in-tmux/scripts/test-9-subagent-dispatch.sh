#!/bin/bash
# test-dispatch.sh — 8 phase-subagent dispatch 测试
# 3 层验证:
#   L1 静态: 文件存在 + frontmatter 合规
#   L2 格式: 必填字段 (name/description) + Meta 守卫存在
#   L3 引用: subagent 引用的 skill 都在 ~/.claude/skills/
# 退出码: 0 = 全过 / 1 = 至少 1 失败

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="/home/zhaocj/ws/cjxdd"
AGENTS_DIR="$REPO_ROOT/agents"
CLAUDE_AGENTS="$HOME/.claude/agents"
CLAUDE_SKILLS="$HOME/.claude/skills"

# 8 phase-subagent + orchestrator
SUBAGENTS=(
    "xdd-orchestrator"
    "phase-researcher"
    "phase-designer"
    "phase-architect"
    "phase-scaffolder"
    "phase-resilience-designer"
    "phase-planner"
    "phase-executor"
    "phase-verifier"
)

REPORT="$SCRIPT_DIR/report.md"
PASS=0
FAIL=0
declare -a FAILED=()

echo "[xdd-dispatch-test] === 9 subagent dispatch 测试 ===" | tee "$REPORT"
echo "[xdd-dispatch-test] agents dir: $AGENTS_DIR" | tee -a "$REPORT"
echo "[xdd-dispatch-test] claude agents: $CLAUDE_AGENTS" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

# === L1 静态: 文件存在 + frontmatter ===
echo "=== L1 静态: 文件存在 + frontmatter ===" | tee -a "$REPORT"
for sa in "${SUBAGENTS[@]}"; do
    file="$AGENTS_DIR/${sa}.md"
    if [[ ! -f "$file" ]]; then
        echo "  ❌ $sa: 文件不存在 ($file)" | tee -a "$REPORT"
        FAILED+=("$sa-L1-no-file")
        ((FAIL++)) || true
        continue
    fi

    # 检查 frontmatter 有 name 字段
    if ! head -5 "$file" | grep -qE "^name: ${sa}$|^name: ${sa} "; then
        echo "  ❌ $sa: frontmatter name 字段错" | tee -a "$REPORT"
        FAILED+=("$sa-L1-name")
        ((FAIL++)) || true
        continue
    fi

    # 检查 description 字段
    if ! head -10 "$file" | grep -qE "^description:"; then
        echo "  ❌ $sa: 缺 description 字段" | tee -a "$REPORT"
        FAILED+=("$sa-L1-desc")
        ((FAIL++)) || true
        continue
    fi

    # 检查 Meta 守卫段
    if ! grep -qE 'Meta 守卫|Meta 任务|is_meta_project' "$file"; then
        echo "  ⚠ $sa: 缺 Meta 守卫段 (改 cjxdd 时可能误触发)" | tee -a "$REPORT"
        # 不算 fail, 但警告
    fi

    # 检查没有 tools 字段 (CC 和 OC schema 互斥, 故意省略)
    if grep -qE "^tools:" "$file"; then
        echo "  ❌ $sa: 含 tools 字段 (CC/OC schema 互斥, 应省略)" | tee -a "$REPORT"
        FAILED+=("$sa-L1-tools")
        ((FAIL++)) || true
        continue
    fi

    echo "  ✓ $sa: L1 文件 + frontmatter OK" | tee -a "$REPORT"
    ((PASS++)) || true
done

# === L1.5 软链: ~/.claude/agents/ 都有 symlink ===
echo "" | tee -a "$REPORT"
echo "=== L1.5 软链: ~/.claude/agents/ ===" | tee -a "$REPORT"
for sa in "${SUBAGENTS[@]}"; do
    link="$CLAUDE_AGENTS/${sa}.md"
    if [[ ! -L "$link" ]]; then
        echo "  ❌ $sa: ~/.claude/agents/${sa}.md 不是 symlink" | tee -a "$REPORT"
        FAILED+=("$sa-L1.5-symlink")
        ((FAIL++)) || true
    elif [[ ! -e "$link" ]]; then
        echo "  ❌ $sa: symlink 指向不存在 (dangling)" | tee -a "$REPORT"
        FAILED+=("$sa-L1.5-dangling")
        ((FAIL++)) || true
    else
        echo "  ✓ $sa: 软链 OK" | tee -a "$REPORT"
        ((PASS++)) || true
    fi
done

# === L2 引用: subagent 引用的 skill 都在 ~/.claude/skills/ ===
echo "" | tee -a "$REPORT"
echo "=== L2 引用: subagent 提的 skill ===" | tee -a "$REPORT"
declare -A USED_SKILLS=()
for sa in "${SUBAGENTS[@]}"; do
    file="$AGENTS_DIR/${sa}.md"
    [[ -f "$file" ]] || continue

    # 提 skill 引用 (e.g. xdd-init, xdd-bdd, xdd-l0, ...)
    # 1. 装 xdd-init / 装 xdd-bdd / 装 xdd-l0 (CJK 间夹)
    # 2. (xdd-init) (xdd-bdd) (xdd-l0) (括号内)
    # 3. `xdd-init` `xdd-bdd` (反引号内)
    # 排除 xdd-gate-* (是 hook 不是 skill)
    mapfile -t refs < <(
        grep -ohE 'xdd-[a-z][a-z0-9-]+' "$file" 2>/dev/null | \
        grep -vE '^xdd-gate-|^xdd-walker|^xdd-orchestrator|^xdd-schema|^xdd-halt|^xdd-status|^xdd-e2e|^xdd-gates|^xdd-goal$|^xdd-scaffold-docker' | \
        sort -u
    )

    for skill in "${refs[@]}"; do
        # 排除 subagent 自己 (phase-*)
        [[ "$skill" =~ ^phase- ]] && continue
        USED_SKILLS["$skill"]=1
    done
done

# 验证所有用到的 skill 都存在
for skill in "${!USED_SKILLS[@]}"; do
    if [[ ! -d "$CLAUDE_SKILLS/$skill" ]]; then
        echo "  ❌ skill: $skill 不在 ~/.claude/skills/" | tee -a "$REPORT"
        FAILED+=("skill-$skill-missing")
        ((FAIL++)) || true
    else
        echo "  ✓ skill: $skill OK" | tee -a "$REPORT"
        ((PASS++)) || true
    fi
done

# === L3 orchestrator dispatch 表 ===
echo "" | tee -a "$REPORT"
echo "=== L3 orchestrator dispatch 表 ===" | tee -a "$REPORT"
orch_file="$AGENTS_DIR/xdd-orchestrator.md"
for sa in "${SUBAGENTS[@]}"; do
    [[ "$sa" == "xdd-orchestrator" ]] && continue
    if grep -q "$sa" "$orch_file"; then
        echo "  ✓ orchestrator 引用 $sa" | tee -a "$REPORT"
        ((PASS++)) || true
    else
        echo "  ❌ orchestrator 未引用 $sa" | tee -a "$REPORT"
        FAILED+=("orch-missing-$sa")
        ((FAIL++)) || true
    fi
done

# === L3.5 必填产物: 8 subagent 都声明必填产物 ===
echo "" | tee -a "$REPORT"
echo "=== L3.5 必填产物声明 ===" | tee -a "$REPORT"
for sa in "${SUBAGENTS[@]}"; do
    [[ "$sa" == "xdd-orchestrator" ]] && continue
    file="$AGENTS_DIR/${sa}.md"
    [[ -f "$file" ]] || continue
    if grep -qE '必填产物|必填|outputs?' "$file"; then
        echo "  ✓ $sa: 声明必填产物" | tee -a "$REPORT"
        ((PASS++)) || true
    else
        echo "  ⚠ $sa: 未声明必填产物" | tee -a "$REPORT"
        # 警告, 不算 fail
    fi
done

# === 汇总 ===
echo "" | tee -a "$REPORT"
echo "=== 汇总 ===" | tee -a "$REPORT"
echo "PASS: $PASS" | tee -a "$REPORT"
echo "FAIL: $FAIL" | tee -a "$REPORT"

if [[ $FAIL -eq 0 ]]; then
    echo "" | tee -a "$REPORT"
    echo "✅ 9 subagent dispatch 测试全过" | tee -a "$REPORT"
    exit 0
else
    echo "" | tee -a "$REPORT"
    echo "❌ 失败项 (${#FAILED[@]}):" | tee -a "$REPORT"
    for f in "${FAILED[@]}"; do
        echo "  - $f" | tee -a "$REPORT"
    done
    exit 1
fi
