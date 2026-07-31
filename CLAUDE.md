# mailnotmilk

Use the `mailnotmilk` MCP server for cross-agent mail.

## Habit

- Start: `whoami`, `register_agent`
- Loop: `check_inbox` (use `wait_ms` when expecting a peer)
- Tasks: `post_handoff` with title/objective/files/acceptance
- Chatter: `post_message` (DM or room; `@mention` peers)
- Finish a chunk: `post_turn`
- Ack with `read_message`; continue via `reply_message` / `get_thread`
- Situational awareness: `mailbox_board`

Slash: `/mailbox`
