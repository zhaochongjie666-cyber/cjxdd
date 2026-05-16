#!/usr/bin/env bash
# gate-check-l1p5.sh — L1.5 Gate 硬校验
# 用法: bash skills/shadow-l1p5-architecture/scripts/gate-check-l1p5.sh <slug>

set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
    echo "用法: $0 <slug>"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SHADOW_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
SHADOW_DIR="$PROJECT_DIR/.shadow"
L15_ROOT="$SHADOW_DIR/L1.5-architecture"
source "$PROJECT_DIR/skills/shadow-l1-flow/scripts/iter-helpers.sh"
gate_init_checks
trap gate_cleanup_checks EXIT

resolve_l1_dir() {
    local input="$1"
    if [ -d "$SHADOW_DIR/L1-business/$input" ]; then
        printf '%s\n' "$SHADOW_DIR/L1-business/$input"
        return 0
    fi
    local match
    match=$(find "$SHADOW_DIR/L1-business" -maxdepth 1 -mindepth 1 -type d -name "B??-$input" | head -n 1)
    if [ -n "$match" ]; then
        printf '%s\n' "$match"
        return 0
    fi
    return 1
}

resolve_l15_dir() {
    local input="$1"
    if [ -d "$L15_ROOT/$input" ]; then
        printf '%s\n' "$L15_ROOT/$input"
        return 0
    fi
    local match
    match=$(find "$L15_ROOT" -maxdepth 1 -mindepth 1 -type d -name "B??-$input" | head -n 1)
    if [ -n "$match" ]; then
        printf '%s\n' "$match"
        return 0
    fi
    return 1
}

extract_section() {
    local file="$1"
    local section="$2"
    awk -v section="$section" '
        $0 ~ "^##[[:space:]]+([0-9]+(\\.[0-9]+)*\\.?[[:space:]]+)?" section "[[:space:]]*$" { in_section=1; next }
        in_section && /^##[[:space:]]+/ { exit }
        in_section { print }
    ' "$file"
}

check_labeled_items() {
    local file="$1"
    local section="$2"
    local check_prefix="$3"
    shift 3
    local block
    block="$(extract_section "$file" "$section")"
    if [ -z "$block" ]; then
        fail "$(basename "$file") 缺少章节: $section" "${check_prefix}.section" "$section"
        return
    fi
    ok "$(basename "$file") 包含章节: $section" "${check_prefix}.section" "$section"
    local label
    for label in "$@"; do
        if printf '%s\n' "$block" | grep -Eq "^[[:space:]]*-[[:space:]]*${label}：[^[]|^[[:space:]]*-[[:space:]]*${label}：[[:space:]]*[^[]"; then
            ok "$(basename "$file") 已回应 ${label}" "${check_prefix}.label" "$label"
        else
            fail "$(basename "$file") 缺少或未实质回应 ${label}" "${check_prefix}.label" "$label"
        fi
    done
}

L15_DIR="$(resolve_l15_dir "$SLUG" || true)"
[ -n "$L15_DIR" ] || L15_DIR="$L15_ROOT/$SLUG"
L1_DIR="$(resolve_l1_dir "$SLUG" || true)"

PASS=0
FAIL=0

l1p5_check_meta() {
    local status="$1"
    local check_id="$2"
    local severity="info"
    if [ "$status" = FAIL ]; then
        severity="high"
    fi
    case "$check_id" in
        l1p5.dir.exists)
            [ "$status" = FAIL ] && severity="blocking"
            printf '%s|%s|%s\n' "architecture_workspace" "$severity" "创建或修正 L1.5 业务目录后重跑 gate-check-l1p5.sh"
            ;;
        l1p5.arch.exists|l1p5.arch.lines|l1p5.arch.coverage)
            printf '%s|%s|%s\n' "architecture_contract" "$severity" "补齐 architecture.md 的规模、结构或 L1 规则映射"
            ;;
        l1p5.l1-handoff.*|l1p5.arch-handoff.*)
            printf '%s|%s|%s\n' "handoff_absorption" "$severity" "根据 spec.md 的 给 L1.5 的输入，补齐 architecture.md 的 L1 交接吸收（架构）"
            ;;
        l1p5.file-list.exists|l1p5.file-list.coverage)
            printf '%s|%s|%s\n' "file_mapping" "$severity" "补齐 file-list.md，并确保覆盖全部 L1 规则"
            ;;
        l1p5.quality.exists|l1p5.quality.start-command)
            printf '%s|%s|%s\n' "quality_contract" "$severity" "修正 quality.md 中的一键启动命令和质量约束"
            ;;
        l1p5.l1.rule-ids|l1p5.mapping.available)
            [ "$status" = FAIL ] && severity="blocking"
            printf '%s|%s|%s\n' "traceability" "$severity" "确保可读取 L1 spec，并建立 L1→L1.5 的完整映射"
            ;;
        *)
            printf '%s|%s|%s\n' "l1p5_hard_gate" "$severity" "根据该检查项补齐 L1.5 架构产物后重跑 gate-check-l1p5.sh"
            ;;
    esac
}

l1p5_record() {
    local status="$1" check_id="${2:-}" message="$3" evidence="${4:-}"
    local meta category severity remediation
    meta=$(l1p5_check_meta "$status" "$check_id")
    category="${meta%%|*}"
    meta="${meta#*|}"
    severity="${meta%%|*}"
    remediation="${meta#*|}"
    case "$severity" in
        info|low|medium|high|blocking) ;;
        *) severity="info" ;;
    esac
    gate_record_check "$status" "$check_id" "$message" "$evidence" "$category" "$severity" "$remediation"
}

ok(){ echo "✅ $1"; PASS=$((PASS + 1)); l1p5_record PASS "${2:-}" "$1" "${3:-}"; }
fail(){ echo "❌ $1"; FAIL=$((FAIL + 1)); l1p5_record FAIL "${2:-}" "$1" "${3:-}"; }

echo "=== L1.5 Gate Hard Check ==="
echo ""

# 1. 目录存在
if [ -d "$L15_DIR" ]; then
    ok "L1.5 目录存在" "l1p5.dir.exists" "$L15_DIR"
else
    fail "L1.5 目录不存在: $L15_DIR" "l1p5.dir.exists" "$L15_DIR"
fi

# 2. architecture.md
ARCH_FILE="$L15_DIR/architecture.md"
if [ -f "$ARCH_FILE" ]; then
    lines=$(wc -l < "$ARCH_FILE")
    if [ "$lines" -ge 40 ]; then
        ok "architecture.md 行数足够 ($lines >= 40)" "l1p5.arch.lines" "$lines"
    else
        fail "architecture.md 行数不足 ($lines < 40)" "l1p5.arch.lines" "$lines"
    fi
else
    fail "architecture.md 不存在" "l1p5.arch.exists" "$ARCH_FILE"
fi

# 3. file-list.md
if [ -f "$L15_DIR/file-list.md" ]; then
    ok "file-list.md 存在" "l1p5.file-list.exists" "$L15_DIR/file-list.md"
else
    fail "file-list.md 不存在" "l1p5.file-list.exists" "$L15_DIR/file-list.md"
fi

# 4. quality.md + 一键启动
if [ -f "$L15_DIR/quality.md" ]; then
    if grep -q "一键启动命令已配置" "$L15_DIR/quality.md" && grep -Eq 'cd .+ && |npm run dev|uv run python -m|python -m uvicorn|uvicorn |go run |spring-boot:run|docker compose up|pnpm dev|yarn dev' "$L15_DIR/quality.md"; then
        ok "quality.md 存在且一键启动已配置" "l1p5.quality.start-command" "$L15_DIR/quality.md"
    else
        fail "quality.md 存在但一键启动缺失或不完整" "l1p5.quality.start-command" "$L15_DIR/quality.md"
    fi
else
    fail "quality.md 不存在" "l1p5.quality.exists" "$L15_DIR/quality.md"
fi

# 5. L1 -> architecture / file-list 规则映射
if [ -n "$L1_DIR" ] && [ -f "$L1_DIR/spec.md" ] && [ -f "$L15_DIR/architecture.md" ] && [ -f "$L15_DIR/file-list.md" ]; then
    mapfile -t rules < <(grep -oE '[A-Za-z0-9_-]+-R[0-9]+' "$L1_DIR/spec.md" | sort -u)
    if [ ${#rules[@]} -eq 0 ]; then
        fail "L1 spec 中未发现规则 ID" "l1p5.l1.rule-ids" "$L1_DIR/spec.md"
    else
        arch_missing=0
        file_missing=0
        for rule in "${rules[@]}"; do
            grep -q "$rule" "$L15_DIR/architecture.md" || arch_missing=$((arch_missing+1))
            grep -q "$rule" "$L15_DIR/file-list.md" || file_missing=$((file_missing+1))
        done
        if [ "$arch_missing" -eq 0 ]; then
            ok "architecture.md 覆盖全部 L1 规则 (${#rules[@]} 条)" "l1p5.arch.coverage" "${#rules[@]}"
        else
            fail "architecture.md 缺少 ${arch_missing} 条 L1 规则映射" "l1p5.arch.coverage" "$arch_missing"
        fi
        if [ "$file_missing" -eq 0 ]; then
            ok "file-list.md 覆盖全部 L1 规则 (${#rules[@]} 条)" "l1p5.file-list.coverage" "${#rules[@]}"
        else
            fail "file-list.md 缺少 ${file_missing} 条 L1 规则映射" "l1p5.file-list.coverage" "$file_missing"
        fi
    fi
else
    fail "无法建立 L1 → L1.5 规则映射校验" "l1p5.mapping.available"
fi

# 6. L1 handoff -> architecture absorption
if [ -n "$L1_DIR" ] && [ -f "$L1_DIR/spec.md" ]; then
    check_labeled_items "$L1_DIR/spec.md" "给 L1.5 的输入" "l1p5.l1-handoff" \
        "模块边界" "文件职责" "接口/集成边界" "外部依赖与约束"
else
    fail "L1 spec.md 缺失，无法检查 L1.5 交接输入" "l1p5.l1-handoff.section" "${L1_DIR:-$SHADOW_DIR/L1-business/$SLUG}/spec.md"
fi

if [ -f "$L15_DIR/architecture.md" ]; then
    check_labeled_items "$L15_DIR/architecture.md" "L1 交接吸收（架构）" "l1p5.arch-handoff" \
        "模块边界承接" "文件职责承接" "接口/集成边界承接" "外部依赖与约束承接"
else
    fail "architecture.md 缺失，无法检查架构交接吸收" "l1p5.arch-handoff.section" "$L15_DIR/architecture.md"
fi

echo ""
echo "=== Result: PASS=$PASS FAIL=$FAIL ==="

if [ "$FAIL" -eq 0 ]; then
    exit 0
else
    exit 1
fi
