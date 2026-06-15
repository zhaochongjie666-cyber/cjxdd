#!/usr/bin/env bash
# regression/run-nightly.sh — xdd framework 凌晨回归测试入口（系统 crontab 调它）
#
# 机制：crontab @ ~01:03 → 此脚本（bash 编排）→
#   TIER 1  静态 smoke（确定性 bash，13 项，无 LLM）
#   TIER 2  ×N 个独立 trial：每个 mktemp 空目录 → 无头 m2cc -p（MiniMax-M3）驱动
#           xdd-walker 走完整 init→understand→…→verify 做 hello-API → 自检 → 出结构化结果
#   TIER 3  任一 trial/smoke 失败 → 无头 m2cc -p 做"项目级修复验证"：根因 → 改 framework
#           到 regression-fix-<日期> 分支（不碰 main）→ 重跑该检查 → 证明修复有效
#   最后  汇总报告到 regression/reports/<ts>.md
#
# "测试三次" 默认 N=3（查 LLM 驱动流程的确定性/flaky）。N 可用 TRIALS 环境变量覆盖。
# 手动跑： bash regression/run-nightly.sh        调试： TRIALS=1 bash regression/run-nightly.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
export PATH="$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"   # crontab PATH 极简，补 claude/node/git

. "$REPO/regression/lib/m2cc-env.sh"

TRIALS="${TRIALS:-3}"
TRIAL_TMO="${TRIAL_TMO:-2400}"   # 每个 trial 上限 40 min（walker 全流程 ~12-20 min）
FIX_TMO="${FIX_TMO:-1200}"       # 每次修复验证上限 20 min
TRIAL_GAP="${TRIAL_GAP:-120}"    # trial 间隔（让 MiniMax 429 限流窗口恢复）
TS="$(date +%Y%m%d-%H%M%S)"
DATE="$(date +%Y%m%d)"
RUNS="$REPO/regression/runs/$TS"
REPORTS="$REPO/regression/reports"
mkdir -p "$RUNS" "$REPORTS"
LOG="$RUNS/run.log"
REPORT="$REPORTS/$TS.md"

log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# ---------- 函数（须先定义后调用） ----------
subst_prompt() {  # <template> <out>  从当前 shell 变量替换占位符（# 分隔，路径安全）
  sed -e "s#\${TRIAL_NUM}#${TRIAL_NUM:-0}#g" \
      -e "s#\${DATE}#${DATE}#g" \
      -e "s#\${FAILURE_EVIDENCE_FILE}#${FAILURE_EVIDENCE_FILE:-}#g" \
      -e "s#\${TRIAL_LOG_FILE}#${TRIAL_LOG_FILE:-}#g" \
      "$1" > "$2"
}
grab_block(){ printf '%s' "$1" | awk '/^<<<XDD_REGRESS_RESULT:BEGIN>>/{f=1} f{print} /^<<<XDD_REGRESS_RESULT:END>>/{exit}'; }
field(){ printf '%s' "$1" | grep -m1 -oE "^$2: .*" | sed -E "s/^$2: //"; }

# run_fix_verify <trial_num> <evidence_file> <trial_log_file>
# 在 cjxdd 仓库根（CWD=REPO）跑无头 m2cc 做根因+修复+重验；结果块存盘
run_fix_verify() {
  local tn="$1" ev="$2" tlog="$3"
  TRIAL_NUM="$tn"; export FAILURE_EVIDENCE_FILE="$ev"; export TRIAL_LOG_FILE="$tlog"
  local fp="$RUNS/fix-trial-$tn.prompt.md"
  subst_prompt "$REPO/regression/prompts/fix-verify.md" "$fp"
  local oldpwd; oldpwd="$(pwd)"; cd "$REPO"
  run_m2cc_prompt "$fp" "$FIX_TMO" 2>"$RUNS/fix-trial-$tn-progress.log"
  local rc=$?; cd "$oldpwd"
  local fout="$M2CC_LAST_OUT"; printf '%s' "$fout" > "$RUNS/fix-trial-$tn-m2cc.out"
  local fblock fst branch rv
  fblock="$(grab_block "$fout")"
  fst="$(field "$fblock" status)"; fst="${fst:-UNRESOLVED}"
  pv="$(field "$fblock" pathway_verdict)"; pv="${pv:-BROKEN}"
  branch="$(field "$fblock" fix_branch)"; rv="$(field "$fblock" reverify)"
  log "TIER 3 trial $tn: status=$fst pathway=$pv branch=${branch:--} reverify=${rv:--}"
  TRIAL_FIX[$tn]="$fst|$pv|$branch|$rv"     # status | pathway_verdict | branch | reverify
  [ "$fst" = "FIXED" ] && FIXES_APPLIED=$((FIXES_APPLIED+1))
  printf '%s\n' "$fblock" > "$RUNS/fix-trial-$tn-result.txt"
}

# ---------- 状态 ----------
SMOKE_STATUS=FAIL
declare -a TRIAL_STATUS=() TRIAL_FIX=()
FIXES_APPLIED=0

# ---------- 报告头 ----------
{
  echo "# xdd 回归测试报告 — $TS"
  echo
  echo "- 时间: $TS"
  echo "- git HEAD: $(git rev-parse --short HEAD 2>/dev/null)  dirty: $(git status --porcelain 2>/dev/null | wc -l) files"
  echo "- trials: $TRIALS   模型: MiniMax-M3[1m] (via m2cc -p 无头)"
  echo
} > "$REPORT"

log "=== xdd 凌晨回归测试 开始 $TS ==="
log "repo=$REPO HEAD=$(git rev-parse --short HEAD 2>/dev/null) trials=$TRIALS"

# ---------- TIER 1: 静态 smoke ----------
log "--- TIER 1: 静态 smoke (13 项, 确定性) ---"
if bash "$REPO/skills/smoke-xdd-design-anchor.sh" >"$RUNS/smoke.log" 2>&1; then
  SMOKE_STATUS=PASS; log "TIER1 smoke: PASS"
else
  SMOKE_STATUS=FAIL; log "TIER1 smoke: FAIL → 触发修复验证"
  FAILURE_EVIDENCE_FILE="$RUNS/smoke-evidence.txt"; TRIAL_LOG_FILE="$RUNS/smoke.log"; TRIAL_NUM=0
  { echo "tier: 1 (静态 smoke)"; echo "exit: 非0"; echo; echo "--- smoke.log ---"; cat "$RUNS/smoke.log"; } > "$FAILURE_EVIDENCE_FILE"
  run_fix_verify 0 "$FAILURE_EVIDENCE_FILE" "$RUNS/smoke.log"
fi

# ---------- TIER 2/3: N 个 trial ----------
for n in $(seq 1 "$TRIALS"); do
  TRIAL_NUM="$n"
  demo="$RUNS/trial-$n"; mkdir -p "$demo"
  prompt="$RUNS/trial-$n.prompt.md"
  subst_prompt "$REPO/regression/prompts/trial-e2e.md" "$prompt"
  log "--- TIER 2 trial $n/$TRIALS: 无头 m2cc 驱动 walker (demo=$demo) ---"
  oldpwd="$(pwd)"; cd "$demo"
  run_m2cc_prompt "$prompt" "$TRIAL_TMO" 2>"$RUNS/trial-$n-progress.log"
  rc=$?; cd "$oldpwd"
  out="$M2CC_LAST_OUT"; printf '%s' "$out" > "$RUNS/trial-$n-m2cc.out"
  block="$(grab_block "$out")"
  st="$(field "$block" status)"
  [ "$rc" -ne 0 ] && [ -z "$st" ] && st="FAIL"
  st="${st:-FAIL}"
  log "trial $n: m2cc exit=$rc status=$st"
  if [ "$st" = "PASS" ]; then
    TRIAL_STATUS[$n]=PASS; printf '%s\n' "$block" > "$RUNS/trial-$n-result.txt"
  else
    TRIAL_STATUS[$n]=FAIL
    FAILURE_EVIDENCE_FILE="$RUNS/trial-$n-evidence.txt"; TRIAL_LOG_FILE="$RUNS/trial-$n-m2cc.out"
    { echo "trial: $n  m2cc exit: $rc"; echo "demo dir: $demo"; echo; echo "--- 结果块 ---"; printf '%s\n' "$block"; echo; echo "(完整 m2cc 输出见 $TRIAL_LOG_FILE)"; } > "$FAILURE_EVIDENCE_FILE"
    log "trial $n FAIL → 触发 TIER 3 修复验证"
    run_fix_verify "$n" "$FAILURE_EVIDENCE_FILE" "$TRIAL_LOG_FILE"
  fi
  # 限流恢复间隔（最后一个 trial 不用等）
  if [ "$n" -lt "$TRIALS" ]; then
    log "trial 间隔: sleep ${TRIAL_GAP}s（让 MiniMax 429 限流窗口恢复）"
    sleep "$TRIAL_GAP"
  fi
done

# ---------- 汇总判定 ----------
# GREEN = smoke PASS 且 每个 trial PASS，或被 TIER 3 判回 VIABLE/FIXED
# （NO_FRAMEWORK_CHANGE + pathway_verdict=VIABLE = 失败是 harness artifact，通路其实可行）
verdict_one() {  # <status> <"fst|pv|...">
  local st="$1" fix="$2" fst pv
  [ "$st" = PASS ] && return 0
  fst="$(printf '%s' "$fix" | cut -d'|' -f1)"
  pv="$(printf '%s' "$fix" | cut -d'|' -f2)"
  case "$fst" in
    FIXED) return 0 ;;
    NO_FRAMEWORK_CHANGE) [ "$pv" = VIABLE ] && return 0 || return 1 ;;
    *) return 1 ;;
  esac
}
OVERALL=GREEN
verdict_one "$SMOKE_STATUS" "${TRIAL_FIX[0]:-}" || OVERALL=RED
for n in $(seq 1 "$TRIALS"); do
  verdict_one "${TRIAL_STATUS[$n]:-FAIL}" "${TRIAL_FIX[$n]:-}" || OVERALL=RED
done

# ---------- 写报告 ----------
{
  echo "## 结果"
  echo
  echo "| 项 | 结果 |"
  echo "|----|------|"
  echo "| TIER 1 smoke (13 项) | $SMOKE_STATUS |"
  for n in $(seq 1 "$TRIALS"); do
    s="${TRIAL_STATUS[$n]:-FAIL}"; fix="${TRIAL_FIX[$n]:-}"
    echo "| TIER 2 trial $n | $s ${fix:+(TIER3: ${fix%%|*}, 重验: ${fix##*|})} |"
  done
  echo
  if [ "$OVERALL" = GREEN ]; then
    echo "### ✅ 通路可行 (GREEN)"
    [ "$FIXES_APPLIED" -gt 0 ] && echo "> 注: 有 $FIXES_APPLIED 处 framework 回归被夜跑修复（见 regression-fix-$DATE 分支），下一晚应 clean PASS。"
  else
    echo "### ❌ 通路不可行 (RED) — 见上面 FAIL 项 + runs/$TS/ 日志"
  fi
  echo
  echo "## 证据"
  echo "- 运行目录: \`runs/$TS/\`"
  echo "- 各 trial 完整 m2cc 输出: \`runs/$TS/trial-*-m2cc.out\`"
  echo "- 各结果块: \`runs/$TS/*-result.txt\`"
  echo "- 修复分支(若有): regression-fix-$DATE"
} >> "$REPORT"

find "$REPO/regression/runs" -maxdepth 1 -mindepth 1 -type d -mtime +7 -exec rm -rf {} \; 2>/dev/null || true

log "=== 完成: OVERALL=$OVERALL  报告=$REPORT ==="
[ "$OVERALL" = GREEN ] && exit 0 || exit 1
