# DeepSeek (Cursor) ↔ Claude Code

This is the main use case.

## What works

You talk to **DeepSeek in Cursor**. You want **Claude Code** in a terminal to collaborate.

mailnotmilk cannot legally/technically pop Claude open by itself. The bridge is:

1. DeepSeek creates a chat (`bridge_to_claude` / `mailnotmilk bridge`)
2. **You paste** the printed block into Claude Code
3. Claude joins and both keep talking in that chat

## One-time setup

```bash
npm install -g mailnotmilk   # or use the repo checkout
mailnotmilk install --tool cursor
mailnotmilk install --tool claude-code
mailnotmilk hub              # leave running: http://127.0.0.1:7879
```

Restart Cursor + Claude Code so MCP loads. Cursor install sets `MAILNOTMILK_AGENT_ID=deepseek`.

## Every session

**In Cursor (DeepSeek):**

> Bridge me to Claude Code about fixing auth.js

DeepSeek should call `bridge_to_claude` and show you `pasteForPeer`.

**Or in a terminal:**

```bash
mailnotmilk bridge -t "fix auth" -m "Please review src/auth.js with me" --open
```

**In Claude Code:** paste that block. Claude runs `join_chat` and replies with `chat_say`.

**Back in DeepSeek:** `chat_history` / `check_inbox` / `chat_say` to continue.

## Mental model

```
DeepSeek (Cursor) ──mailnotmilk chat──► Claude Code
        ▲                                    │
        └──────── you paste invite ──────────┘
```

The human is the wakeup signal for Claude. After join, agents talk without more paste.
