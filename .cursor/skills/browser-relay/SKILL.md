---
name: browser-relay
description: >-
  Drive ChatGPT/DeepSeek/etc headlessly via Playwright + mailnotmilk MCP —
  stay in the coding-agent terminal; no hub UI or browser windows by default.
allowed-tools: CallMcpTool, Shell
---

# browser-relay

## Goal

Seamless talk inside Claude Code / Cursor / Codex / Gemini / OpenCode. Messages you send via MCP are typed into the browser AI composer; replies are extracted back into the same mailnotmilk chat.

Default: **headless**. Do not open the hub UI. Do not require `--remote-debugging-port`.

## Tools (mailnotmilk MCP)

| Tool | Use |
|------|-----|
| `browser_connect` | Headless Chrome/Firefox (persistent profile). `headless: false` only for first login |
| `browser_open_ai` | Navigate to chatgpt / deepseek / … |
| `browser_extract_messages` | Parse visible chat turns |
| `browser_send_message` | Type + send into the composer |
| `relay_tick` | browser → chat → wait peer → browser |
| `chat_say` / `chat_history` / `check_inbox` | Same session as the peer agent |

## Flow

1. `browser_connect` (omit headless → true)
2. `browser_open_ai` `{ "site": "chatgpt" }`
3. `create_chat` or `join_chat` for the peer
4. `chat_say` your message; `relay_tick` or `browser_send_message` to push into the web AI
5. Poll `chat_history` / `check_inbox` for peer replies

## Safety

- Only automate chats the user authorized
- Prefer persistent profiles under `~/.mailnotmilk/browser-profiles/`
- Never store passwords in the mailbox DB
