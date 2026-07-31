#!/usr/bin/env bash
# Hub API + browser relay via Chrome extension (normal shortcut, any site).
# One-time: mailnotmilk extension → Load unpacked
# Usage:
#   ./run.sh
#   ./run.sh --site deepseek --peer claude
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

echo "Extension folder (Load unpacked once if needed): $ROOT/extension" >&2
exec "$NODE" "$CLI" run "$@"
