# mailnotmilk

[![ci](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml/badge.svg)](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml)

Shared **agent mailbox** MCP. Cursor, Claude Code, and other MCP hosts post, poll, hand off, and reply across sessions — milk not required.

## Install

```bash
npm install -g mailnotmilk
mailnotmilk install --all --hooks
```

Restart Cursor / Claude Code.

## Why this exists

Copy-pasting between agent tabs is dumb. `mailnotmilk` is a local SQLite mailbox both sides read through MCP tools + CLI:

- DMs, rooms, `@mentions`
- Structured **handoffs** (title / objective / acceptance / files)
- **Turn summaries** so peers see what you just did
- Threads, search, archive, reactions, priority
- `watch` daemon + terminal **board**
- Optional Cursor/Claude hook helpers

## Quick start

```bash
mailnotmilk install --tool cursor
mailnotmilk install --tool claude-code

# CLI round-trip
MAILNOTMILK_AGENT_ID=cursor mailnotmilk handoff --to claude \
  --title "Review auth" --objective "Check src/auth.js" --file src/auth.js
MAILNOTMILK_AGENT_ID=claude mailnotmilk inbox --pretty
MAILNOTMILK_AGENT_ID=claude mailnotmilk watch   # live poll
mailnotmilk board
```

Ask either agent: *"Check mailnotmilk inbox and handle handoffs."*

## MCP tools

| Tool | Purpose |
|------|---------|
| `whoami` / `register_agent` | Identity |
| `post_message` | DM / broadcast / @mention |
| `post_handoff` | Structured task packet |
| `post_turn` | End-of-turn summary |
| `check_inbox` | Unread (priority-sorted, optional `wait_ms`) |
| `read_message` / `mark_unread` | Ack / un-ack |
| `reply_message` / `get_thread` | Conversation |
| `search_messages` / `list_history` | Lookup |
| `archive_message` / `react_message` | Housekeeping |
| `list_agents` / `list_rooms` / `subscribe_room` | Roster |
| `set_status` / `get_status` | Presence |
| `mailbox_stats` / `mailbox_board` | Situational awareness |

## Collaboration loop

1. Cursor: `post_handoff` → Claude
2. Claude: `check_inbox` → `read_message` → work → `reply_message` / `post_turn`
3. Cursor: `check_inbox` → continue

Override identity with `MAILNOTMILK_AGENT_ID`. Data: `~/.mailnotmilk/mailbox.db` (or `$MAILNOTMILK_DATA_DIR`).

## CLI

```text
serve · install · whoami · send · handoff · turn
inbox · thread · search · history · watch · board · stats
rooms · agents · status · react · archive · hooks
```

## Design notes

Inspired by multi-agent awareness patterns (envelopes, provider detect, DM vs room) — original Node + `node:sqlite` WAL implementation, not a port of Polylogue or anything else.

## License

MIT
