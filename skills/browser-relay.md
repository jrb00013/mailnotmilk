---
name: browser-relay
description: >-
  Drive Chrome/Firefox (Playwright) against ChatGPT, DeepSeek, Gemini, Copilot web UIs —
  extract messages, type replies, relay to mailnotmilk coding agents headlessly.
allowed-tools: CallMcpTool, Shell
---

# browser-relay

## Tools (mailnotmilk MCP)

| Tool | Use |
|------|-----|
| `browser_connect` | Attach Chrome/Firefox (launch or CDP) |
| `browser_open_ai` | Navigate to known AI chat sites |
| `browser_extract_messages` | Parse visible chat turns |
| `browser_send_message` | Type + send into the composer |
| `browser_screenshot` | Capture the page |
| `browser_disconnect` | Close session |
| `relay_tick` | One poll: browser → chat → wait peer → browser |

## Sites

`chatgpt` · `deepseek` · `claude` · `gemini` · `copilot` · or raw `url`

## Safety

- Only automate chats the user explicitly opened/authorized
- Prefer persistent user profiles (`--user-data-dir`) over logging into sites blindly
- Never store passwords in the mailbox DB
