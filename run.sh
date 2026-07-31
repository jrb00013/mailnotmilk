#!/usr/bin/env bash
# Start hub + ChatGPT/DeepSeek browser relay (CDP attach if Chrome is on :9222).
# Usage:
#   ./run.sh
#   ./run.sh --site chatgpt --peer claude
#   ./run.sh --site deepseek --browser firefox
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  echo "node not found on PATH" >&2
  exit 1
fi

CLI="$ROOT/bin/mailnotmilk.js"
if [[ ! -f "$CLI" ]]; then
  echo "missing $CLI" >&2
  exit 1
fi

if [[ ! -d "$ROOT/node_modules/playwright" ]]; then
  echo "→ Playwright missing; running install (browsers)…"
  (cd "$ROOT" && "$NODE" "$CLI" install --browsers-only --skip-deps) || true
fi

exec "$NODE" "$CLI" run "$@"
