#!/usr/bin/env bash
# Hub API + browser relay. Always (re)installs the Chrome extension, then runs.
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

# Ensure extension registration before run (also done inside `mailnotmilk run`)
echo "→ ensuring Chrome extension…" >&2
"$NODE" "$CLI" extension >/dev/null || true

exec "$NODE" "$CLI" run "$@"
