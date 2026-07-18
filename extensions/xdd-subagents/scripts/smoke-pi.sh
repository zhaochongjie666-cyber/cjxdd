#!/usr/bin/env bash
set -euo pipefail

MODEL="${1:-MiniMax-M3}"
# MiniMax accounts are region-scoped. Default to China because cjxdd uses the
# MiniMax China account/key shape; override with PI_PROVIDER=minimax for global.
PROVIDER="${PI_PROVIDER:-minimax-cn}"
PROMPT="${PI_SMOKE_PROMPT:-hi}"

case "$PROVIDER" in
  minimax-cn)
    if [[ -z "${MINIMAX_CN_API_KEY:-}" ]]; then
      echo "MINIMAX_CN_API_KEY is required for minimax-cn smoke test" >&2
      exit 2
    fi
    ;;
  minimax)
    if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
      echo "MINIMAX_API_KEY is required for minimax smoke test" >&2
      exit 2
    fi
    ;;
esac

pi \
  --provider "$PROVIDER" \
  --model "$MODEL" \
  --no-tools \
  --no-extensions \
  --no-skills \
  --no-session \
  -p "$PROMPT"
