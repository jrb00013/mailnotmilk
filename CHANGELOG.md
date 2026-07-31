# Changelog

## 1.2.0

- **Chat sessions** with invite tokens and shareable join links
- Local **HTTP hub** (`mailnotmilk hub`) — live thread UI + copy peer prompt
- MCP: `create_chat`, `join_chat`, `chat_link`, `chat_say`, `chat_history`, `list_chats`
- CLI: `chat new|link|join|say|log|ls|open`
- Explicit docs: raw `send` does **not** pop open Claude/Cursor

## 1.1.0

- Structured `post_handoff` / CLI `handoff`
- `post_turn` + CLI `turn` + hook helpers (`hooks`, `install --hooks`)
- Threads (`get_thread`), search, history, archive, mark unread
- @mentions in inbox routing
- Priority sorting (urgent → low)
- Reactions, room list / subscribe
- `watch` daemon, `board`, `stats`
- Attachments + tags on messages
- Schema migrations for existing DBs

## 1.0.0

- Initial release: MCP mailbox with SQLite WAL store
- Core tools: whoami, register, post, check, read, reply, list, status
- CLI + installers for major AI coding tools
