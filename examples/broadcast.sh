#!/usr/bin/env bash
set -euo pipefail
export MAILNOTMILK_DATA_DIR="${MAILNOTMILK_DATA_DIR:-/tmp/mailnotmilk-broadcast}"
MAILNOTMILK_AGENT_ID=cursor mailnotmilk send -r standup -t "daily: shipping mailbox MCP"
MAILNOTMILK_AGENT_ID=claude mailnotmilk inbox
MAILNOTMILK_AGENT_ID=codex mailnotmilk inbox
