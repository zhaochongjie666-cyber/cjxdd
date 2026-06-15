#!/usr/bin/env bash
# regression/lib/m2cc-env.sh — 为无头回归测试加载 MiniMax-M3 环境
#
# 等价于交互式 `m2cc`，但无头（claude -p）。从 ~/.bashrc 的 m2cc() 函数体提取 env
# （token 不硬编码到本仓库，随 bashrc 更新而更新），export 供 claude -p 用。
#
# 用法（在 run-nightly.sh 里）:
#   source /path/to/regression/lib/m2cc-env.sh
#   run_m2cc_prompt <prompt_file> [timeout_secs] [extra claude args...]
#   echo "$M2CC_LAST_OUT"      # 完整 stdout

_M2CC_BODY=""

# _m2cc_get <KEY>  →  打印 m2cc 函数体里该 export 的值
_m2cc_get() {
  [ -n "$_M2CC_BODY" ] || _M2CC_BODY="$(bash -lic 'declare -f m2cc' 2>/dev/null)"
  [ -n "$_M2CC_BODY" ] || { echo "✗ m2cc 函数未找到（~/.bashrc 里没有？）" >&2; return 1; }
  printf '%s' "$_M2CC_BODY" | grep -oE "$1=\"[^\"]+\"" | head -1 | sed -E "s/^$1=\"//; s/\"$//"
}

# 加载 m2cc 的 env 到当前 shell
m2cc_env_load() {
  local t b m
  t="$(_m2cc_get ANTHROPIC_AUTH_TOKEN)"; b="$(_m2cc_get ANTHROPIC_BASE_URL)"; m="$(_m2cc_get ANTHROPIC_MODEL)"
  { [ -n "$t" ] && [ -n "$b" ] && [ -n "$m" ]; } || { echo "✗ 从 m2cc 提取 token/base/model 失败" >&2; return 1; }
  export ANTHROPIC_AUTH_TOKEN="$t"
  export ANTHROPIC_BASE_URL="$b"
  export ANTHROPIC_MODEL="$m"
  export ANTHROPIC_SMALL_FAST_MODEL="$(_m2cc_get ANTHROPIC_SMALL_FAST_MODEL)"
  export ANTHROPIC_DEFAULT_SONNET_MODEL="$(_m2cc_get ANTHROPIC_DEFAULT_SONNET_MODEL)"
  export ANTHROPIC_DEFAULT_OPUS_MODEL="$(_m2cc_get ANTHROPIC_DEFAULT_OPUS_MODEL)"
  export ANTHROPIC_DEFAULT_HAIKU_MODEL="$(_m2cc_get ANTHROPIC_DEFAULT_HAIKU_MODEL)"
  export API_TIMEOUT_MS="$(_m2cc_get API_TIMEOUT_MS)"
  export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
  export CLAUDE_CODE_AUTO_COMPACT_WINDOW="$(_m2cc_get CLAUDE_CODE_AUTO_COMPACT_WINDOW)"
}

# run_m2cc_prompt <prompt_file> [timeout_secs] [extra claude args...]
# 在调用者 CWD 跑 claude -p（无头 MiniMax-M3，bypassPermissions，自主）。
# 完整 stdout → 全局 M2CC_LAST_OUT。失败（exit!=0 或输出空，常见于 MiniMax 429 频率限流
# 杀掉会话）会按指数退避重试 M2CC_RETRIES 次（默认 2），让限流窗口恢复。
run_m2cc_prompt() {
  local prompt_file="$1"; shift
  local tmo="${1:-2400}"; shift || true
  local retries="${M2CC_RETRIES:-2}"
  [ -f "$prompt_file" ] || { echo "✗ prompt 不存在: $prompt_file" >&2; return 2; }
  m2cc_env_load || return 1
  local attempt rc backoff
  for attempt in $(seq 0 "$retries"); do
    echo "[$(date +%H:%M:%S)] ▶ m2cc -p attempt $((attempt+1))/$((retries+1)) (timeout ${tmo}s, model=${ANTHROPIC_MODEL}, cwd=$(pwd))" >&2
    M2CC_LAST_OUT="$(timeout "$tmo" claude --permission-mode bypassPermissions \
      --model "$ANTHROPIC_MODEL" -p "$(cat "$prompt_file")" "$@" 2>&1)"
    rc=$?
    if [ "$rc" -eq 0 ] && [ -n "$M2CC_LAST_OUT" ]; then
      echo "[$(date +%H:%M:%S)] ■ m2cc -p exit=0 (成功, 输出 ${#M2CC_LAST_OUT} 字节)" >&2
      return 0
    fi
    echo "[$(date +%H:%M:%S)] ■ m2cc -p exit=$rc 输出=${#M2CC_LAST_OUT}字节 — 失败（疑似 429 限流/超时）" >&2
    [ "$attempt" -lt "$retries" ] || { echo "  ⚠ 重试用尽（$((retries+1)) 次）" >&2; return "$rc"; }
    backoff=$((90 * (attempt + 1)))   # 90s, 180s, ...
    echo "  ⏳ 等 ${backoff}s 再重试（让 MiniMax 限流窗口恢复）..." >&2
    sleep "$backoff"
  done
  return 1
}
