# Changelog

## 1.5.4

- Never ask the user to log in — auth is optional
- Default: attach/start the user's Chrome session via CDP (auto `--remote-debugging-port`)
- Removed "sign in once with --headed" messaging from docs/skills/MCP

## 1.5.3

- Default **headless** browser + **no hub UI** (`./run.sh` no longer pops windows)
- CDP / `--remote-debugging-port` is optional (`--cdp`); persistent profile is the default path
- MCP `browser_connect` defaults `headless: true`
- Docs/skills: terminal-first MCP UX

## 1.5.2

- Default **skip** `playwright install-deps` (broken apt PPAs no longer look like hard failures)
- Install writes `~/.local/bin/mailnotmilk` shim so `mailnotmilk` works after PATH refresh
- Hub always started via `node …/bin/mailnotmilk.js` (never bare PATH lookup)
- Clearer warning when relay is not CDP-attached to your real ChatGPT Chrome tab

## 1.5.1

- `./install.sh --run` installs then starts hub + relay
- `./run.sh` / `run.cmd` / `run.ps1` — hub + ChatGPT relay (CDP attach to Chrome `:9222` when available)
- Default site is `chatgpt`; auto-prints Claude paste prompt

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
