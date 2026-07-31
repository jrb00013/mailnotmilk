---
name: browser-relay
description: >-
  Drive ChatGPT/DeepSeek/etc via the user's browser session + mailnotmilk MCP.
  Never ask the user to log in — auth is optional.
allowed-tools: CallMcpTool, Shell
---

# browser-relay

## Goal

Stay in the coding-agent terminal. Messages go into the browser AI composer; replies come back via MCP. **Do not ask the user to sign in.**

## Tools

| Tool | Use |
|------|-----|
| `browser_connect` | Prefer attach to user's Chrome (CDP). Starts Chrome with debugging if needed |
| `browser_open_ai` | Navigate only if needed |
| `browser_extract_messages` / `browser_send_message` | Read / type |
| `relay_tick` / `chat_say` / `chat_history` | Same mailnotmilk session as the peer |

## Rules

- Never instruct the user to log into ChatGPT / DeepSeek / etc.
- Never open the hub UI unless they ask
- Prefer their browser session over a separate Playwright profile
