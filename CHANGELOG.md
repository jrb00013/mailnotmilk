# Changelog

## 1.6.4

- **Fix: Firefox opened `http://automationcontrolled/` on every launch.** The Chromium-only `--disable-blink-features=AutomationControlled` switch was passed to both engines, and Firefox treats an unrecognised argument as a URL. Chromium keeps the flag; Firefox gets none.
- **Site is now detected from the URL each tick instead of pinned by `--site`.** Navigate the tab to any supported AI and the relay follows it, using that site's selectors. It only navigates when the current page is not a chat it recognises, so it no longer yanks the tab away from where you are.
- New `syncSiteFromUrl()` / `currentUrl()`; extension mode reads the live tab through `extListTabs`.

## 1.6.3

- **Fix: streamed replies were forwarded mid-generation and silently truncated.** The relay posted the first extraction whose text differed from the previous turn — true the moment streaming starts. A 6.6k-char reply was arriving as 703 chars, cut mid-sentence, with nothing to indicate it was incomplete. Completion is now a state machine (`createTurnSettler`) requiring both text quiescence *and* the page reporting not-generating; quiescence alone fires on any pause between tokens.
- Unknown generating state (extension mode has no stop button to read) is carried as its own value rather than collapsed into "not generating" — it demands a doubled quiet window instead. Treating unknown as negative would have reintroduced the bug in the one mode that cannot detect it.
- A capture that never settles is still forwarded, but annotated `_(relay: capture did not settle …)_`. Silent truncation was the worst property of the original bug.
- **Fix: a truncated post used to permanently suppress its own completed version.** Dedup matched on prefix overlap, and a partial shares a prefix with the finished answer. A strictly longer continuation of an existing post now counts as new.
- Assistant turns are no longer forwarded while a reply is actively streaming.
- **Site matching no longer hardcodes URLs.** Hostnames derive from each site's own `url` plus optional `aliases`; the duplicate `match` map, a second copy in `urlIncludesForSite`, and an inline tab-picker regex are gone. Subdomains match (`eu.chatgpt.com`), suffix lookalikes do not (`chatgpt.com.evil.test`).
- Any URL now works without a site entry: a `GENERIC` profile supplies message/composer/send/stop selectors, so unrecognised sites keep completion detection instead of silently losing it.
- User-defined sites via `~/.mailnotmilk/sites.json` — new chat UIs need no code change.
- 25 tests covering streaming completion, dedup, and URL matching (`tests/browser-sites.test.js`, `tests/relay-dedup.test.js`).

## 1.6.2

- `./run.sh` and `./install.sh --run` always (re)install the Chrome extension and launch Chrome with `--load-extension` if the extension has not said hello yet

## 1.6.1

- Relay forwards ChatGPT **assistant** turns into the chat (was extracted then dropped)
- Echo filter: do not re-post peer→browser injects as `## From browser (…) user`
- After typing into the browser, wait for a new assistant reply and forward it

## 1.6.0

- **Fix: Claude Code MCP install never took effect.** The server was written only to `~/.claude/settings.json`, which Claude Code does not read `mcpServers` from — so `join_chat`/`chat_say`/`check_inbox` never appeared in a session. Now writes `~/.claude.json` (the canonical user scope) as well.
- Config edits are merge-not-clobber: a parse error aborts instead of silently resetting the file to `{}`, and every rewritten config gets a `.bak`. Previously a malformed `~/.claude.json` or a project `.mcp.json` holding other servers could be wiped.
- Install output tells you how to verify: restart Claude Code, then `claude mcp list`.
- Chrome extension bridge: drive **any** AI tab from a normal Chrome shortcut (no `--remote-debugging-port`)
- Hub `/api/ext/*` long-poll command queue
- `mailnotmilk extension` prints Load unpacked path
- `./run.sh` prefers extension → CDP → Playwright

## 1.5.5

- Detect Cloudflare challenge; wait for “Verify you are human” instead of silently extracting 0 messages
- Use system Chrome (`channel: chrome`) + dedicated CDP profile `~/.mailnotmilk/chrome-cdp`
- Stronger ChatGPT message selectors

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
