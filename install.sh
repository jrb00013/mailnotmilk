#!/usr/bin/env bash
# Jayden-style entrypoint — works on Linux native, macOS, and Windows WSL.
# Windows native: use install.cmd or install.ps1
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Prefer node from PATH; fall back to common locations
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

# Ensure npm deps (incl. playwright) before install/relay
if [[ ! -d "$ROOT/node_modules/playwright" ]] && [[ ! -d "$ROOT/node_modules/@modelcontextprotocol" ]]; then
  echo "→ npm install (first run)…"
  (cd "$ROOT" && npm install)
elif [[ ! -d "$ROOT/node_modules/playwright" ]]; then
  echo "→ npm install playwright…"
  (cd "$ROOT" && npm install playwright@^1.49.0 --save)
fi

# Default = full install including browsers
if [[ $# -eq 0 ]]; then
  set -- install --tools all --skills --global-skills --target "$ROOT"
elif [[ "$1" != "install" && "$1" != "serve" && "$1" != "hub" && "$1" != "bridge" && "$1" != "relay" && "$1" != "whoami" ]]; then
  set -- install "$@"
fi

# If bare `install`, bake in skills + browsers (browsers auto unless --skip-browsers)
if [[ "$1" == "install" ]]; then
  has_tools=0
  for a in "$@"; do
    case "$a" in
      --tools|--tool|--all|--skills|--global-skills|--browsers-only|--skip-browsers|--target) has_tools=1 ;;
    esac
  done
  # If user only said `./install.sh install`, expand to full defaults
  if [[ $# -eq 1 ]]; then
    set -- install --tools all --skills --global-skills --target "$ROOT"
  fi
fi

exec "$NODE" "$CLI" "$@"
