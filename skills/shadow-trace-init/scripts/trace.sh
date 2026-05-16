#!/usr/bin/env bash
# trace.sh — L1 ↔ L5 双向追溯脚本
# 用法:
#   trace.sh forward  <RULE_ID>     从 L1 规则查实现代码（正向）
#   trace.sh reverse  <file_path>   从代码文件查 L1 规则（反向）
#   trace.sh node     <BXX-NYY>     从业务节点查实现代码（节点级正向）
#   trace.sh biz      <BXX>         查看整个业务线的所有节点和实现
#   bash skills/shadow-trace-init/scripts/trace.sh coverage [slug] 生成规则覆盖矩阵（默认全部 slug）
#   bash skills/shadow-trace-init/scripts/trace.sh matrix          生成完整追溯矩阵 Markdown

set -uo pipefail

SHADOW_DIR="${SHADOW_DIR:-.shadow}"
PROJECT_DIR="${PROJECT_DIR:-.}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ──────────────────────────────────────────
# 数据提取
# ──────────────────────────────────────────

# 从代码文件提取 @implements
extract_implements_code() {
    # Python: # @implements: slug-R01
    grep -rnoP '^\s*#\s*@implements:\s*(.+)' \
        --include='*.py' "$PROJECT_DIR" 2>/dev/null | \
        sed -E 's/:([^:]*@implements:.*$)/:\1/' | \
        sed -E 's/.*@implements:\s*//' || true

    # TS/JS: * @implements: slug-R01 或 // @implements: slug-R01
    grep -rnoP '(//|\*)\s*@implements:\s*(.+)' \
        --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
        "$PROJECT_DIR" 2>/dev/null | \
        sed -E 's/.*@implements:\s*//' || true
}

# 从 L5 Plan 提取 @implements
extract_implements_plan() {
    grep -rnoP '@implements:\s*(.+)' \
        "$SHADOW_DIR/L5-plan/" 2>/dev/null | \
        sed -E 's/.*@implements:\s*//' || true
}

# 从测试提取 @covers
extract_covers_test() {
    grep -rnoP '@covers:\s*(.+)' \
        "$PROJECT_DIR/server/tests/" "$PROJECT_DIR/tests/" \
        "$PROJECT_DIR/client/src/__tests__/" "$PROJECT_DIR/frontend/src/__tests__/" \
        "$PROJECT_DIR/src/__tests__/" 2>/dev/null | \
        sed -E 's/.*@covers:\s*//' || true
}

# 从 spec.md 提取所有规则 ID
extract_rules_from_spec() {
    local slug="$1"
    local spec="$SHADOW_DIR/L1-business/${slug}/${slug}.spec.md"
    if [ -f "$spec" ]; then
        grep -oP "${slug}-R\d+" "$spec" 2>/dev/null | sort -u
    fi
}

# ──────────────────────────────────────────
# 构建映射
# ──────────────────────────────────────────

# 构建 规则ID → 文件列表 映射
build_rule_to_files() {
    declare -A rule_map

    # 从代码提取
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file rules
        file="$(echo "$line" | cut -d: -f1)"
        rules="$(echo "$line" | cut -d: -f2-)"
        IFS=',' read -ra rarr <<< "$rules"
        for r in "${rarr[@]}"; do
            r="$(echo "$r" | xargs)"  # trim
            [ -z "$r" ] && continue
            if [ -z "${rule_map[$r]:-}" ]; then
                rule_map[$r]="$file"
            else
                # 去重
                if [[ "${rule_map[$r]}" != *"$file"* ]]; then
                    rule_map[$r]="${rule_map[$r]},$file"
                fi
            fi
        done
    done < <(extract_implements_code)

    # 从 L5 plan 提取
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local file rules
        file="$(echo "$line" | cut -d: -f1)"
        rules="$(echo "$line" | cut -d: -f2-)"
        file="L5:${file#*$SHADOW_DIR/}"  # 标记为 L5 Plan 层
        IFS=',' read -ra rarr <<< "$rules"
        for r in "${rarr[@]}"; do
            r="$(echo "$r" | xargs)"
            [ -z "$r" ] && continue
            if [ -z "${rule_map[$r]:-}" ]; then
                rule_map[$r]="$file"
            else
                if [[ "${rule_map[$r]}" != *"$file"* ]]; then
                    rule_map[$r]="${rule_map[$r]},$file"
                fi
            fi
        done
    done < <(extract_implements_plan)

    # 输出
    for r in $(echo "${!rule_map[@]}" | tr ' ' '\n' | sort); do
        echo "$r|${rule_map[$r]}"
    done
}

# 构建 文件 → 规则ID列表 映射
build_file_to_rules() {
    # 从代码提取
    grep -rnoP '(//|\*)\s*@implements:\s*(.+)' \
        --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
        "$PROJECT_DIR" 2>/dev/null | \
        while IFS= read -r line; do
            local file rules
            file="$(echo "$line" | sed -E 's/^([^:]+):.*/\1/')"
            rules="$(echo "$line" | sed -E 's/.*@implements:\s*//' | sed 's/\r$//')"
            echo "$file|$rules"
        done
}

# ──────────────────────────────────────────
# 命令实现
# ──────────────────────────────────────────

cmd_forward() {
    local rule="$1"
    echo -e "${CYAN}=== 正向追溯: $rule ===${NC}"
    echo ""

    # 查找 spec 中的规则描述
    local slug
    slug="$(echo "$rule" | sed -E 's/-R[0-9]+$//')"
    local spec="$SHADOW_DIR/L1-business/${slug}/${slug}.spec.md"
    if [ -f "$spec" ]; then
        local desc
        desc="$(grep -A1 "$rule" "$spec" 2>/dev/null | tail -1 | sed 's/^[[:space:]]*//' | head -c 120)"
        echo -e "  ${GREEN}规则描述${NC}: $desc"
    fi
    echo ""

    # 查找 L5 Plan
    echo -e "  ${YELLOW}L5 Plan:${NC}"
    local plan_files
    plan_files="$(grep -rl "$rule" "$SHADOW_DIR/L5-plan/" 2>/dev/null | sed "s|$SHADOW_DIR/L5-plan/||" || true)"
    if [ -n "$plan_files" ]; then
        echo "$plan_files" | while IFS= read -r f; do
            echo "    📐 $f"
        done
    else
        echo "    (无)"
    fi
    echo ""

    # 查找代码实现
    echo -e "  ${YELLOW}L5 代码实现:${NC}"
    local code_files
    code_files="$(grep -rl "@implements:.*$rule" --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' "$PROJECT_DIR" 2>/dev/null | sed "s|$PROJECT_DIR/||" || true)"
    if [ -n "$code_files" ]; then
        echo "$code_files" | while IFS= read -r f; do
            local line_num
            line_num="$(grep -n "@implements:.*$rule" "$PROJECT_DIR/$f" 2>/dev/null | head -1 | cut -d: -f1)"
            echo "    💻 $f (line:$line_num)"
        done
    else
        echo "    (无 — ⚠️ 未实现)"
    fi
    echo ""

    # 查找测试覆盖
    echo -e "  ${YELLOW}测试覆盖:${NC}"
    test_files="$(grep -rl "@covers:.*$rule" \
        "$PROJECT_DIR/server/tests/" "$PROJECT_DIR/tests/" \
        "$PROJECT_DIR/client/src/__tests__/" "$PROJECT_DIR/frontend/src/__tests__/" \
        "$PROJECT_DIR/src/__tests__/" 2>/dev/null | sed "s|$PROJECT_DIR/||" || true)"
    if [ -n "$test_files" ]; then
        echo "$test_files" | while IFS= read -r f; do
            echo "    🧪 $f"
        done
    else
        echo "    (无 — ⚠️ 未覆盖)"
    fi
}

cmd_reverse() {
    local filepath="$1"
    echo -e "${CYAN}=== 反向追溯: $filepath ===${NC}"
    echo ""

    local matches
    matches="$(grep -noP '@implements:\s*(.+)' "$PROJECT_DIR/$filepath" 2>/dev/null | head -20 || true)"
    if [ -z "$matches" ]; then
        echo -e "  ${RED}未找到 @implements 标记${NC}"
        exit 1
    fi

    echo -e "  ${YELLOW}实现的规则:${NC}"
    echo "$matches" | while IFS= read -r line; do
        local line_num rules
        line_num="$(echo "$line" | cut -d: -f1)"
        rules="$(echo "$line" | cut -d: -f2- | sed 's/^[[:space:]]*//')"
        echo "    第 ${line_num} 行: ${rules}"

        # 显示规则描述
        for r in $(echo "$rules" | tr ',' '\n' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//'); do
            local slug
            slug="$(echo "$r" | sed -E 's/-R[0-9]+$//')"
            local spec="$SHADOW_DIR/L1-business/${slug}/${slug}.spec.md"
            if [ -f "$spec" ]; then
                local desc
                desc="$(grep -A1 "$r" "$spec" 2>/dev/null | tail -1 | sed 's/^[[:space:]]*//' | head -c 80)"
                echo "      → $desc"
            fi
        done
    done
}

cmd_node() {
    local node="$1"
    # Extract BXX from BXX-NYY
    local biz="${node%%-*}"
    local num="${node#*-}"
    echo -e "${CYAN}=== 节点追溯: $node ===${NC}"
    echo ""
    echo -e "  业务线: ${GREEN}${biz}${NC}"
    echo -e "  节点编号: ${GREEN}${num}${NC}"
    echo ""

    # Find spec rules referencing this node
    echo -e "  ${YELLOW}关联的 L1 规则:${NC}"
    local found=0
    for spec in "$SHADOW_DIR/L1-business"/*/spec.md; do
        [ -f "$spec" ] || continue
        if grep -q "$node" "$spec" 2>/dev/null; then
            found=1
            grep -n "$node" "$spec" | head -5 | while IFS= read -r line; do
                echo "    📋 $line"
            done
        fi
    done
    [ $found -eq 0 ] && echo "    (spec 中无直接引用，按规则 ID 关联查找)"
    echo ""

    # Find code implementing this node
    echo -e "  ${YELLOW}L5 代码实现（搜索 $(basename "$node") 引用）:${NC}"
    local code_files
    code_files=$(grep -rl "$node" --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' "$PROJECT_DIR" 2>/dev/null | grep -v '/\.shadow/' | head -10 || true)
    if [ -n "$code_files" ]; then
        echo "$code_files" | while IFS= read -r f; do
            echo "    💻 ${f#$PROJECT_DIR/}"
        done
    else
        echo "    (无直接节点引用 — 建议补充 @implements: slug-${node})"
    fi

    # Find test coverage
    echo ""
    echo -e "  ${YELLOW}测试覆盖:${NC}"
    local test_files
    test_files=$(grep -rl "$node" \
        "$PROJECT_DIR/server/tests/" "$PROJECT_DIR/tests/" \
        "$PROJECT_DIR/client/src/__tests__/" "$PROJECT_DIR/frontend/src/__tests__/" \
        "$PROJECT_DIR/src/__tests__/" 2>/dev/null | head -5 || true)
    [ -n "$test_files" ] && echo "$test_files" | while IFS= read -r f; do echo "    🧪 ${f#$PROJECT_DIR/}"; done || echo "    (无)"
}

cmd_biz() {
    local biz="$1"
    echo -e "${CYAN}=== 业务线全局视图: $biz ===${NC}"
    echo ""

    # Find all nodes in project.flow.mermaid for this biz
    echo -e "  ${YELLOW}流程节点清单:${NC}"
    for flow in "$SHADOW_DIR/L1-business/project.flow.mermaid" "$SHADOW_DIR/L1-business/flow.mermaid" "$SHADOW_DIR/L1-business"/*/flow.mermaid "$SHADOW_DIR/L1-business"/*/*.flow.mermaid; do
        [ -f "$flow" ] || continue
        local nodes
        nodes=$(grep -oE "N[0-9]{2}" "$flow" 2>/dev/null | sort -u || true)
        if [ -n "$nodes" ]; then
            echo "$nodes" | while IFS= read -r n; do
                local desc
                desc=$(grep "$n\[" "$flow" 2>/dev/null | head -1 | sed 's/.*-->\(.*\)/\1/' | head -c 120 || true)
                echo "    📍 $biz-$n $desc"
            done
        fi
    done

    # Find all code files implementing this biz
    echo ""
    echo -e "  ${YELLOW}实现文件（含 BXX-NYY 引用）:${NC}"
    local code_files
    code_files=$(grep -rl "${biz}-N" --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' "$PROJECT_DIR" 2>/dev/null | grep -v '/\.shadow/' | head -15 || true)
    [ -n "$code_files" ] && echo "$code_files" | while IFS= read -r f; do echo "    💻 ${f#$PROJECT_DIR/}"; done || echo "    (无 — 建议为代码添加 BXX-NYY 节点引用)"

    # Summary
    echo ""
    echo -e "  ${GREEN}业务线 $biz 全貌已展示。${NC}"
    echo "  运行 bash skills/shadow-trace-init/scripts/trace.sh coverage <slug> 查看规则级覆盖。"
    echo "  运行 trace.sh node ${biz}-N01 查看单节点。"
}

cmd_coverage() {
    local target_slug="${1:-}"
    echo -e "${CYAN}=== L1 规则覆盖矩阵 ===${NC}"
    echo ""

    # 收集所有 slug
    local slugs=()
    if [ -n "$target_slug" ]; then
        slugs=("$target_slug")
    else
        while IFS= read -r d; do
            slugs+=("$(basename "$d")")
        done < <(find "$SHADOW_DIR/L1-business/" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
    fi

    # 构建映射
    declare -A rule_files
    while IFS='|' read -r rule files; do
        [ -z "$rule" ] && continue
        rule_files[$rule]="$files"
    done < <(build_rule_to_files)

    declare -A rule_tests
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local rules
        rules="$(echo "$line" | cut -d: -f2- | sed 's/^[[:space:]]*//')"
        IFS=',' read -ra rarr <<< "$rules"
        for r in "${rarr[@]}"; do
            r="$(echo "$r" | xargs)"
            [ -z "$r" ] && continue
            if [ -z "${rule_tests[$r]:-}" ]; then
                rule_tests[$r]="1"
            fi
        done
    done < <(extract_covers_test)

    printf "%-45s | %-6s | %-6s | %-8s\n" "规则" "代码" "测试" "状态"
    printf "%-45s | %-6s | %-6s | %-8s\n" "---------------------------------------------" "------" "------" "--------"

    for slug in "${slugs[@]}"; do
        local has_header=0
        while IFS= read -r rule; do
            [ -z "$rule" ] && continue
            if [ $has_header -eq 0 ]; then
                echo ""
                echo "  [$slug]"
                has_header=1
            fi
            local short_rule
            short_rule="$(echo "$rule" | sed -E 's/^.*-R/R/')"
            local has_code="❌"
            local has_test="❌"
            local status="⚠️ 未实现"

            if [ -n "${rule_files[$rule]:-}" ]; then
                has_code="✅"
                if [ -n "${rule_tests[$rule]:-}" ]; then
                    has_test="✅"
                    status="✅ 完整"
                else
                    status="🟡 无测试"
                fi
            fi

            printf "  %-43s | %-6s | %-6s | %-8s\n" "$short_rule" "$has_code" "$has_test" "$status"
        done < <(extract_rules_from_spec "$slug")
    done

    echo ""
}

cmd_matrix() {
    echo "# L1 双向追溯矩阵"
    echo ""
    echo "> 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""

    local slugs=()
    while IFS= read -r d; do
        slugs+=("$(basename "$d")")
    done < <(find "$SHADOW_DIR/L1-business/" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)

    # 构建映射
    declare -A rule_files
    while IFS='|' read -r rule files; do
        [ -z "$rule" ] && continue
        rule_files[$rule]="$files"
    done < <(build_rule_to_files)

    declare -A rule_tests
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        local rules
        rules="$(echo "$line" | cut -d: -f2- | sed 's/^[[:space:]]*//')"
        IFS=',' read -ra rarr <<< "$rules"
        for r in "${rarr[@]}"; do
            r="$(echo "$r" | xargs)"
            [ -z "$r" ] && continue
            if [ -z "${rule_tests[$r]:-}" ]; then
                rule_tests[$r]="1"
            fi
        done
    done < <(extract_covers_test)

    for slug in "${slugs[@]}"; do
        echo "## $slug"
        echo ""
        echo "| 规则 | 描述 | L5 Plan | L5 代码 | 状态 |"
        echo "|------|------|---------|---------|------|"

        while IFS= read -r rule; do
            [ -z "$rule" ] && continue
            local short_rule desc impl_files test_status status_icon

            short_rule="$(echo "$rule" | sed -E 's/^.*-R/R/')"

            # 描述
            local spec="$SHADOW_DIR/L1-business/${slug}/${slug}.spec.md"
            if [ -f "$spec" ]; then
                desc="$(grep -A1 "$rule" "$spec" 2>/dev/null | tail -1 | sed 's/^[[:space:]]*//' | head -c 60)"
            else
                desc="-"
            fi

            # L5 Plan
            local plan
            plan="$(grep -rl "$rule" "$SHADOW_DIR/L5-plan/" 2>/dev/null | wc -l || echo 0)"
            if [ "$plan" -gt 0 ]; then
                impl_files="✅ ${plan} 个plan"
            else
                impl_files="-"
            fi

            # L5 代码
            local code_count
            code_count="$(grep -rl "@implements:.*$rule" --include='*.py' --include='*.ts' --include='*.tsx' "$PROJECT_DIR" 2>/dev/null | wc -l || echo 0)"
            if [ "$code_count" -gt 0 ]; then
                impl_files="${impl_files} ✅ ${code_count} 个文件"
            elif [ -z "$impl_files" ] || [ "$impl_files" = "-" ]; then
                impl_files="❌ 未实现"
            fi

            # 状态
            if [ "$code_count" -gt 0 ]; then
                status_icon="✅"
            else
                status_icon="⚠️"
            fi

            echo "| $short_rule | $desc | $plan 个 | $code_count 个 | $status_icon |"
        done < <(extract_rules_from_spec "$slug")

        echo ""
    done
}

# ──────────────────────────────────────────
# 入口
# ──────────────────────────────────────────

case "${1:-help}" in
    forward)
        [ -z "${2:-}" ] && echo "用法: trace.sh forward <RULE_ID>" && exit 1
        cmd_forward "$2"
        ;;
    reverse)
        [ -z "${2:-}" ] && echo "用法: trace.sh reverse <file_path>" && exit 1
        cmd_reverse "$2"
        ;;
    node)
        [ -z "${2:-}" ] && echo "用法: trace.sh node <BXX-NYY>" && exit 1
        cmd_node "$2"
        ;;
    biz)
        [ -z "${2:-}" ] && echo "用法: trace.sh biz <BXX>" && exit 1
        cmd_biz "$2"
        ;;
    coverage)
        cmd_coverage "${2:-}"
        ;;
    matrix)
        cmd_matrix
        ;;
    help|*)
        echo "L1 ↔ L5 双向追溯工具（含 BXX-NYY 节点级路由）"
        echo ""
        echo "用法:"
        echo "  trace.sh forward  <RULE_ID>      从 L1 规则查实现代码"
        echo "  trace.sh reverse  <file_path>    从代码文件查 L1 规则"
        echo "  trace.sh node     <BXX-NYY>      从业务节点查所有实现"
        echo "  trace.sh biz      <BXX>          查看业务线全局节点和实现"
        echo "  bash skills/shadow-trace-init/scripts/trace.sh coverage [slug]  生成规则覆盖矩阵"
        echo "  bash skills/shadow-trace-init/scripts/trace.sh matrix           生成追溯矩阵 Markdown"
        echo ""
        echo "示例:"
        echo "  trace.sh forward auto-labeling-platform-R01"
        echo "  trace.sh node B01-N03"
        echo "  trace.sh biz B01"
        echo "  trace.sh reverse backend/app/api/v1/auth.py"
        echo "  bash skills/shadow-trace-init/scripts/trace.sh coverage auto-labeling-platform"
        echo "  bash skills/shadow-trace-init/scripts/trace.sh matrix > .shadow/L1-business/TRACE.md"
        ;;
esac
