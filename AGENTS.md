# mailnotmilk

MCP server available: `mailnotmilk`

Core loop:
1. `whoami` / `register_agent` at session start
2. `check_inbox` before and after substantive work (`wait_ms` ok)
3. Prefer `post_handoff` for tasks; `post_message` for chatter; `post_turn` when you finish a chunk
4. `read_message` to ack; `reply_message` / `get_thread` to continue
5. Use `mailbox_board` if you need the big picture

Do not wait for the human to say "check your mail" every time.
