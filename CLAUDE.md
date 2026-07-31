# mailnotmilk

Use the `mailnotmilk` MCP server for cross-agent mail (Cursor ↔ Claude Code, etc.).

## Habit

- On start: `whoami`, then `register_agent`
- Before/after real work: `check_inbox` (use `wait_ms` if expecting a peer)
- Handoffs: `post_message` with clear markdown; replies: `reply_message`
- Mark consumption with `read_message` so peers know you got it

## Slash command

`/mailbox` — check inbox and handle pending mail.
