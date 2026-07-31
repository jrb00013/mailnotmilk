# Changelog

## 1.5.0

- `./install.sh` / `install.cmd` / `install.ps1` **auto-install Playwright browsers** (no manual npm/npx step)
- Multiplatform: Linux native, Windows WSL, Windows native, macOS
- Chromium + Firefox + WebKit; Linux/WSL best-effort `install-deps`
- `--browsers-only`, `--skip-browsers`, `--with-deps`, `--skip-deps`

## 1.4.0

- Jayden-style `./install.sh install --tools all --skills --global-skills --target .`
- Skills: `mailnotmilk-bridge`, `browser-relay` → Cursor/Claude/OpenCode/Gemini/Copilot paths
- Chrome **and** Firefox Playwright tools: connect, open AI sites, extract, send, screenshot
- `relay_tick` + CLI `mailnotmilk relay` for browser AI ↔ coding agent loops
- Sites: chatgpt, deepseek, claude, gemini, copilot

## 1.3.0

- First-class **DeepSeek ↔ Claude Code** bridge (`bridge_to_claude`, `mailnotmilk bridge`)
- Claude-specific paste prompts (`pasteForPeer` / `claudePrompt`)
- Cursor install defaults `MAILNOTMILK_AGENT_ID=deepseek`
- Docs: [docs/deepseek-claude.md](docs/deepseek-claude.md)

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
