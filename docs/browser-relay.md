# Browser AI ↔ coding agents

Intended UX: stay in Claude Code / Cursor / Codex / Gemini / OpenCode. Talk via mailnotmilk MCP tools. No ChatGPT window, no hub UI.

Hub is a background HTTP API only. Playwright runs headless against a persistent profile (`~/.mailnotmilk/browser-profiles/`).

## Setup (once)

```bash
./install.sh
# First login to ChatGPT (one-time visible window):
./run.sh --headed --once
# Sign in, then Ctrl-C. After that, headless works.
```

Restart your AI tool so MCP + skills load.

## Day-to-day (in the agent terminal)

Do **not** open browsers. Use MCP:

1. `browser_connect` `{ "browser": "chrome" }` — headless by default  
2. `browser_open_ai` `{ "site": "chatgpt" }`  
3. `chat_say` / `relay_tick` — messages go into the ChatGPT composer; replies come back via `chat_history` / `check_inbox`  
4. Keep polling the same `chat_id` while collaborating

Optional background loop (still headless, no UI):

```bash
./run.sh                    # headless + hub API only
./run.sh --site deepseek --peer claude
./run.sh --headed           # only if you need to see/login
./run.sh --open             # only if you want the optional hub UI
```

## CDP (optional)

Only if you insist on driving your daily Chrome tab:

```bash
google-chrome --remote-debugging-port=9222
./run.sh --cdp
```

You do **not** need this for the default headless path.

## Reality check

- Web AI DOMs change — selectors are best-effort  
- First login often needs `--headed` once (CAPTCHA / OAuth)  
- This does not merge into ChatGPT’s own “session” as Claude’s internal context; it syncs messages through mailnotmilk into the browser composer and back into MCP  
- Nothing auto-opens Claude Code; peers join via MCP `join_chat` or a pasted invite
