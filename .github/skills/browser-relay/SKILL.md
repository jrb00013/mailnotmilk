---
name: browser-relay
description: >-
  Drive any browser AI tab via the mailnotmilk Chrome extension. ./install.sh
  auto-registers it — normal Chrome shortcut, no --remote-debugging-port.
allowed-tools: CallMcpTool, Shell
---

# browser-relay

## Setup

`./install.sh` auto-installs the extension (External Extensions + desktop launcher).
User fully quits Chrome once, then uses the normal shortcut.

Re-run only: `mailnotmilk extension`

## Flow

1. Chrome open normally + any AI site
2. `browser_connect` `{ "mode": "extension" }`
3. `relay_tick` / `chat_say` / `browser_send_message`

## Rules

- Never require `--remote-debugging-port`
- Never ask for manual Load unpacked (install handles it)
- Never ask the user to log in
- Works for any http(s) chat UI
