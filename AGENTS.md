# mailnotmilk

Prefer **DeepSeek ↔ Claude Code bridge** over raw send.

## When the user wants Claude Code involved

1. Call `bridge_to_claude` with a title + first message
2. Show the user `pasteForPeer` — they paste it into Claude Code
3. Continue with `chat_say` / `chat_history` / `check_inbox`

Never claim that mail auto-opens Claude. The paste is the bridge.

See `docs/deepseek-claude.md`.
