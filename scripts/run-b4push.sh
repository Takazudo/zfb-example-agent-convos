#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
guard="$HOME/.codex/scripts/heavy-guard.sh"
if [[ -f "$guard" && "${HEAVY_GUARD_HELD:-0}" != 1 ]]; then
  exec bash "$guard" -- node scripts/b4push.mjs
fi
exec node scripts/b4push.mjs
