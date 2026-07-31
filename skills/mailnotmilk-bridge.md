---
name: mailnotmilk-bridge
description: >-
  Bridge any browser AI (ChatGPT, DeepSeek web, Gemini, Copilot) with Claude Code,
  Cursor, or OpenCode via the mailnotmilk MCP — create chats, paste invites, relay.
allowed-tools: CallMcpTool, Shell
---

# mailnotmilk bridge

## Goal

Keep a **web AI tab** (GPT / DeepSeek / …) talking to a **coding agent** (Claude Code / Cursor / OpenCode).

## Rules

1. Raw `post_message` / `send` does **not** wake the other side.
2. Prefer `bridge_to_claude` or `create_chat` + show `pasteForPeer` to the human.
3. For live browser tabs use `browser_*` / `relay_tick` tools (Chrome or Firefox via Playwright).
4. Coding agents: `join_chat` → `chat_say` / `chat_history` / `check_inbox`.

## DeepSeek or GPT in the browser → Claude Code

1. Ensure hub is up: `mailnotmilk hub`
2. `browser_connect` (chrome or firefox) then `browser_open_ai` for the site
3. `browser_extract_messages` to read the web AI thread
4. `bridge_to_claude` or `chat_say` to forward into Claude
5. When Claude replies, `browser_send_message` posts back into the web UI
6. Or run one-shot: `relay_tick` / CLI `mailnotmilk relay --site deepseek`

## Coding agent → browser AI

1. Claude/Cursor drafts reply in mailnotmilk chat
2. `browser_send_message` injects it into the open web chat
3. Poll with `browser_extract_messages` until a new assistant turn appears
