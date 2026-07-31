# mailnotmilk

[![ci](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml/badge.svg)](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml)

**Talk to DeepSeek in Cursor → bridge that conversation to Claude Code.**

## Your actual goal

```
You ←→ DeepSeek (Cursor)
              ↓  paste invite into Claude Code once
         Claude Code
              ↕  keep chatting via mailnotmilk
         DeepSeek
```

Nothing auto-opens Claude. The product is a **paste block** Claude understands (`join_chat` + `chat_say`).

## Setup once

```bash
npm install -g mailnotmilk   # or run from this repo
mailnotmilk install --tool cursor      # sets MAILNOTMILK_AGENT_ID=deepseek
mailnotmilk install --tool claude-code
mailnotmilk hub                        # http://127.0.0.1:7879
```

Restart Cursor and Claude Code.

## Every time

```bash
mailnotmilk bridge -t "fix auth" -m "Review src/auth.js with me" --open
```

Copy the printed **PASTE INTO CLAUDE CODE** block into Claude Code. Then both agents talk in that chat.

In DeepSeek chat you can also say: *“bridge me to Claude Code about X”* → it should call MCP `bridge_to_claude` and show you `pasteForPeer`.

Full walkthrough: [docs/deepseek-claude.md](docs/deepseek-claude.md)

## Why not `send --to claude`?

That only writes SQLite. Claude will not wake up. Use `bridge` / `bridge_to_claude`.

## License

MIT
