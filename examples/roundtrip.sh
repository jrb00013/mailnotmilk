#!/usr/bin/env bash
set -euo pipefail
DIR="${MAILNOTMILK_DATA_DIR:-/tmp/mailnotmilk-example}"
export MAILNOTMILK_DATA_DIR="$DIR"
rm -rf "$DIR"
MAILNOTMILK_AGENT_ID=cursor mailnotmilk send --to claude -t "please review src/auth.js"
MAILNOTMILK_AGENT_ID=claude mailnotmilk inbox
MAILNOTMILK_AGENT_ID=claude mailnotmilk inbox --read
MAILNOTMILK_AGENT_ID=claude mailnotmilk send --to cursor -t "LGTM with one nit on line 42"
MAILNOTMILK_AGENT_ID=cursor mailnotmilk inbox
