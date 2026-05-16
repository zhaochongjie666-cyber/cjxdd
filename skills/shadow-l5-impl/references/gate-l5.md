## L5 Gate — Harness 计划实现

> 硬 Gate 入口：`bash skills/shadow-l5-impl/scripts/gate-check-l5.sh <slug>`

### 工具调用

```bash
# 0. 运行脚本硬校验
bash skills/shadow-l5-impl/scripts/gate-check-l5.sh <slug>

# 1. Harness 计划 → 真实文件存在性
grep -E '^### 文件:' .shadow/L5-plan/{slug}/harness-plan.md | sed 's/### 文件: //' | while read file; do
  [ -f "$file" ] && echo "OK: $file" || echo "MISSING: $file"
done

# 2. 文件头索引完整性
for f in $(grep -E '^### 文件:' .shadow/L5-plan/{slug}/harness-plan.md | sed 's/### 文件: //'); do
  [ -f "$f" ] || continue
  echo "=== $f ==="
  grep -E '^(\s*\*)?\s*(File:|L1:|L5-Plan:|@implements:)' "$f" | head -6
done

# 3. @implements 一致性：实现文件 vs Harness 计划中标注的规则
for f in $(grep -E '^### 文件:' .shadow/L5-plan/{slug}/harness-plan.md | sed 's/### 文件: //'); do
  [ -f "$f" ] || continue
  code_ids=$(grep -oP '@implements:\s*\K[\w,-]+' "$f" | tr ',' '\n' | sed 's/^ //' | sort -u)
  harness_ids=$(grep -oP '(?<=\*\*规则\*\*: ).*' ".shadow/L5-plan/{slug}/harness-plan.md" | grep -oE '{SLUG}-R[0-9]+' | sort -u)
  diff <(echo "$harness_ids") <(echo "$code_ids") || echo "MISMATCH in $f"
done

# 4. 野生文件检测
for top_dir in backend server src frontend client; do
  [ -d "$top_dir" ] || continue
  find "$top_dir" -type f -not -path '*/\.*' \
    \( -name '*.py' -o -name '*.ts' -o -name '*.js' -o -name '*.vue' -o -name '*.go' \
       -o -name '*.rs' -o -name '*.java' -o -name '*.jsx' -o -name '*.tsx' \) | while read code_file; do
    grep -q "$code_file" .shadow/L5-plan/{slug}/harness-plan.md || echo "WILD: $code_file"
  done
done

# 5. Stub detection (AUTOMATED — FAIL on detection)
echo "=== Python Stub Detection ==="
grep -rn '^\s*pass\s*$' --include='*.py' backend/ frontend/ 2>/dev/null | grep -v test_ || echo "CLEAN: pass"
grep -rn '^\s*return None\s*$' --include='*.py' backend/ 2>/dev/null | grep -v test_ || echo "CLEAN: return None"

echo "=== TypeScript Stub Detection ==="
grep -rn 'return null[;]*$' --include='*.ts' --include='*.vue' frontend/src/ 2>/dev/null | grep -v test || echo "CLEAN: return null"

# Hardcoded secrets:
echo "=== Secret Detection ==="
grep -rn 'dev-secret-key\|change-me-in-production\|minioadmin' --include='*.py' backend/ 2>/dev/null | grep -v test_ | grep -v '.env' || echo "CLEAN: no hardcoded secrets"
```

### 脚本硬校验覆盖点

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | Harness 计划 → 真实代码映射 | Harness 计划中列出的每个文件都必须有真实实现 |
| 2 | 文件头完整 | 每个真实代码文件必须包含 L1 / L5-Plan / @implements |
| 3 | @implements 一致性 | 真实代码与 Harness 计划中标注的规则 ID 必须一致 |
| 4 | L1 全规则覆盖 | 全部 L1 规则必须在真实代码中有实现落点 |
| 5 | 存根与 secret 检测 | 禁止明显存根与硬编码 secret |
| 6 | 野生文件检测 | 不在 Harness 计划中的代码文件应被标记 |

### 语义判断

| # | 检查项 | 方法 |
|---|--------|------|
| 1 | 实现语义一致性 | 抽查 2-3 个方法：读 Harness 计划指令 + 读代码实现前 20 行，判断是否在职责范围内 |
| 2 | 野生文件智能分类 | 对每个 WILD 文件读前 30 行，分类：交付代码(FAIL)/开发辅助(INFO)/生成代码(INFO)/配置(INFO) |
| 3 | 测试诚实度 | 读测试代码，找空函数/pass/永真断言/SKIP |
| 4 | 安全风险 | 检查输入校验、权限检查、敏感数据暴露 |
| 5 | **存根语义检测** | 读每个方法体，判断：签名暗示 DB 操作但无 await？签名暗示查询但 return None/[]？→ FAIL |
| 6 | **硬编码 secret 检测** | grep 配置文件和服务代码中的 dev-secret/change-me/minioadmin → FAIL |
| 7 | **认证实现检查** | 找到所有 get_current_user 函数，检查是否真正调用 verify_token → FAIL if stubbed |
| 8 | **L1 错误码兑现** | 抽查 Harness 计划中错误码是否在实现中有直接落点 |
| 9 | **L1 状态机兑现** | 抽查 Harness 计划中关键状态迁移是否在实现或测试中可观察 |
| 10 | **L1 副作用兑现** | 抽查 Harness 计划中通知/审计/日志/事件是否在代码或测试中有落点 |

---
