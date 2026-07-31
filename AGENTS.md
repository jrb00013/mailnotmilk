# mailnotmilk

MCP server available: `mailnotmilk`

- `whoami` — detected agent id
- `register_agent` — join the roster
- `post_message` — DM or room broadcast
- `check_inbox` — unread mail (optional `wait_ms`)
- `read_message` — ack a message
- `reply_message` — threaded reply
- `list_agents` / `set_status` / `get_status` — presence

When collaborating across Cursor and Claude Code (or other agents):
1. `register_agent` / `whoami` at session start
2. `check_inbox` before and after substantive work
3. `post_message` or `reply_message` with handoffs and results

Do not wait for the human to say "check your mail" every time.
