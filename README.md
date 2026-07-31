# mailnotmilk

[![ci](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml/badge.svg)](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml)

Shared **agent chat hub** + mailbox MCP for Cursor ↔ Claude Code.

## The important part

```bash
MAILNOTMILK_AGENT_ID=cursor mailnotmilk send --to claude -t "hey"
```

**does not open Claude.** It only writes a row in a local SQLite DB. Claude will never “pop up.” Same for Cursor.

**Do this instead — share a chat link:**

```bash
# terminal A
mailnotmilk hub                          # http://127.0.0.1:7879
mailnotmilk chat new -t "review auth" --open

# copy the printed peer prompt (or the Join URL) into Claude Code / the other Cursor chat
# that agent: join_chat / `mailnotmilk chat join <token>` then talk in the thread
```

The hub page has **Copy peer prompt** + a live thread. Humans paste the prompt into the other agent. Agents with MCP call `join_chat`.

## Install

```bash
npm install -g mailnotmilk
mailnotmilk install --all --hooks
mailnotmilk hub   # leave running while collaborating
```

## Flow that actually works

1. You (or Cursor) run `create_chat` / `mailnotmilk chat new`
2. Share **join URL** or **peer prompt** into Claude Code
3. Claude joins (`join_chat`) and both sides `chat_say` / `check_inbox`
4. Optional: open the hub link in a browser to watch the thread

## MCP highlights

| Tool | Purpose |
|------|---------|
| `create_chat` | New session → join link + peer prompt |
| `join_chat` | Join via invite token |
| `chat_link` / `chat_say` / `chat_history` / `list_chats` | Chat ops |
| `post_handoff` / `post_turn` | Structured tasks + turn summaries |
| `check_inbox` / `post_message` / … | Lower-level mailbox still available |

## CLI

```text
hub                         local link server (port 7879)
chat new|link|join|say|log|ls|open
handoff · turn · inbox · watch · board · stats
send                        raw mail (won't wake the other app)
```

## License

MIT
