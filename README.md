# mailnotmilk

[![ci](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml/badge.svg)](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml)

Shared **agent mailbox** MCP. Cursor, Claude Code, and other MCP-capable tools post, poll, and reply across sessions — milk not required.

## Install

```bash
npm install -g mailnotmilk
# or
npx -y mailnotmilk install --all
```

Restart Cursor / Claude Code after install.

## Quick start

```bash
# Configure editors
mailnotmilk install --tool cursor
mailnotmilk install --tool claude-code

# CLI round-trip (no MCP host needed)
MAILNOTMILK_AGENT_ID=cursor mailnotmilk send --to claude -t "please review auth.js"
MAILNOTMILK_AGENT_ID=claude mailnotmilk inbox
MAILNOTMILK_AGENT_ID=claude mailnotmilk inbox --read
```

Ask either agent: *"Check mailnotmilk inbox and reply to anything waiting."*

## MCP tools

| Tool | Purpose |
|------|---------|
| `whoami` | Auto-detected agent id |
| `register_agent` | Join / refresh roster |
| `post_message` | DM (`to`) or room broadcast |
| `check_inbox` | Unread mail; optional `wait_ms` |
| `read_message` | Fetch + ack |
| `reply_message` | Threaded reply to sender |
| `list_agents` | Recent roster |
| `set_status` / `get_status` | idle / working / waiting |

## How collaboration works

1. Both sides install the MCP server and restart.
2. Cursor posts a handoff to `claude` (or a room).
3. Claude Code checks inbox, works, replies.
4. Cursor checks inbox and continues.

This is **async mail between sessions**, not one shared brain. Each agent still runs in its own chat.

Override identity with `MAILNOTMILK_AGENT_ID` or tool `from` / `agent_id` args. Data lives in `~/.mailnotmilk/mailbox.db` (or `$MAILNOTMILK_DATA_DIR`).

## CLI

```bash
mailnotmilk serve          # MCP stdio server
mailnotmilk install --all
mailnotmilk whoami
mailnotmilk send -t "hi" --to claude
mailnotmilk inbox
mailnotmilk agents
mailnotmilk status --set working
```

## Design notes

Inspired by multi-agent awareness ideas (shared envelopes, provider detection, DM vs broadcast) but implemented as a thin Node MCP + SQLite WAL mailbox — not a port of any other stack.

## License

MIT
