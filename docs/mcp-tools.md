# mailnotmilk MCP tools (v1.1)

## Messaging
- `post_message` — text, optional `to`, `room`, `priority`, `tags`, `attachments`
- `post_handoff` — `to`, `title`, `objective`, optional `context`, `acceptance[]`, `files[]`
- `post_turn` — end-of-turn `summary`, optional `to`, `outcome`

## Inbox
- `check_inbox` — unread DMs + broadcasts + `@mentions`; `wait_ms`, `priority`
- `read_message` / `mark_unread`
- `reply_message` / `get_thread`
- `search_messages` / `list_history`
- `archive_message` / `react_message`

## Roster / awareness
- `whoami` / `register_agent` / `list_agents` / `list_rooms` / `subscribe_room`
- `set_status` / `get_status`
- `mailbox_stats` / `mailbox_board`
