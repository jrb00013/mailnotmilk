---
name: browser-relay
description: >-
  Drive any browser AI tab via the mailnotmilk Chrome extension (normal Chrome
  shortcut — no --remote-debugging-port). Works for ChatGPT, DeepSeek, Gemini, etc.
allowed-tools: CallMcpTool, Shell
---

# browser-relay

## Goal

Stay in the coding-agent terminal. Messages go into **whatever AI site tab** the user has open in normal Chrome.

## Setup (once)

```bash
mailnotmilk extension
```

Load unpacked from that folder in `chrome://extensions`. Then use the normal Chrome shortcut forever.

## Flow

1. User opens Chrome normally + any AI site
2. Extension → **Use this tab**
3. `browser_connect` `{ "mode": "extension" }`
4. `browser_open_ai` / `relay_tick` / `chat_say`

## Rules

- Never require `--remote-debugging-port`
- Never ask the user to log in
- Never open the hub UI unless asked
- Works for **any** http(s) chat UI, not just ChatGPT
