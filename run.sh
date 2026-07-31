#!/usr/bin/env bash
# Background hub API + headless ChatGPT/DeepSeek relay (no browser/UI windows).
# Usage:
#   ./run.sh
#   ./run.sh --site chatgpt --peer claude
#   ./run.sh --headed          # once, to log in
#   ./run.sh --open            # optional hub UI
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
