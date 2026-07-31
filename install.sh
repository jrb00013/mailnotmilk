#!/usr/bin/env bash
# Jayden-style entrypoint — Linux / macOS / WSL.
# Windows native: install.cmd / install.ps1
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
elif [[ -x "$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin/node" ]]; then
  NODE="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" | tail -1)/bin/node"
else
  echo "node not found on PATH. Install Node.js >= 22.5" >&2
  exit 1
fi

CLI="$ROOT/bin/mailnotmilk.js"
if [[ ! -f "$CLI" ]]; then
  echo "mailnotmilk CLI missing at $CLI" >&2
  exit 1
fi

# Ensure npm deps
if [[ ! -d "$ROOT/node_modules/@modelcontextprotocol" ]] || [[ ! -d "$ROOT/node_modules/playwright" ]]; then
  echo "→ npm install…"
  (cd "$ROOT" && npm install)
fi

RUN_AFTER=0
ARGS=()
for a in "$@"; do
  if [[ "$a" == "--run" ]]; then
    RUN_AFTER=1
  else
    ARGS+=("$a")
  fi
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

# Default = full install
if [[ $# -eq 0 ]]; then
  set -- install --tools all --skills --global-skills --target "$ROOT"
elif [[ "$1" != "install" && "$1" != "serve" && "$1" != "hub" && "$1" != "bridge" && "$1" != "relay" && "$1" != "run" && "$1" != "whoami" ]]; then
  set -- install "$@"
fi

if [[ "$1" == "install" && $# -eq 1 ]]; then
  set -- install --tools all --skills --global-skills --target "$ROOT"
fi

"$NODE" "$CLI" "$@"

if [[ "$RUN_AFTER" -eq 1 ]]; then
  echo ""
  echo "→ starting hub + relay (./run.sh)…"
  exec "$ROOT/run.sh"
fi
