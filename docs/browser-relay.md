# Browser AI ↔ coding agents

Stay in Claude Code / Cursor / Codex / Gemini. Drive ChatGPT (etc.) through mailnotmilk MCP.

**We never ask you to log in.** Auth is optional. Use whatever Chrome session/page is open.

## Setup

```bash
./install.sh
./run.sh                 # attaches/starts Chrome with CDP; hub API stays background
```

Restart your AI tool so MCP + skills load.

## Day-to-day (agent terminal)

1. `browser_connect` — attaches to your Chrome session (starts Chrome with debugging if needed)
2. `browser_open_ai` `{ "site": "chatgpt" }` — only navigates if needed
3. `chat_say` / `relay_tick` — types into the page composer; replies come back via MCP
4. Poll `chat_history` / `check_inbox`

```bash
./run.sh                       # use Chrome session; no hub UI
./run.sh --no-session          # Playwright only (still no login)
./run.sh --open                # optional hub UI
```

## Reality check

- Chrome must expose CDP for session attach — mailnotmilk starts Chrome with `--remote-debugging-port` when needed (you do not type the flag)
- If your daily Chrome is already open *without* debugging, a second Chrome instance is started for the session (or quit Chrome first so it can reuse your profile)
- Selectors are best-effort; web AI DOMs change
- Does not merge into Claude’s internal context — syncs messages via MCP ↔ page composer
