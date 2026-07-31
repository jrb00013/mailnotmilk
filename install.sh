#!/usr/bin/env bash
# Jayden-style entrypoint: ./install.sh install --target . --tools all
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE="${NODE:-node}"
CLI="$ROOT/bin/mailnotmilk.js"

if [[ ! -f "$CLI" ]]; then
  echo "mailnotmilk CLI missing at $CLI" >&2
  exit 1
fi

# Default subcommand = install (matches jayden UX: ./install.sh install …)
if [[ $# -eq 0 ]]; then
  set -- install --tools all --skills --global-skills
elif [[ "$1" != "install" && "$1" != "serve" && "$1" != "hub" && "$1" != "bridge" && "$1" != "relay" ]]; then
  set -- install "$@"
fi

exec "$NODE" "$CLI" "$@"
