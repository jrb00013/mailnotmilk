# mailnotmilk

[![ci](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml/badge.svg)](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml)

Bridge **any browser AI** (ChatGPT, DeepSeek web, Gemini, Copilot, Claude.ai) with **Claude Code / Cursor / OpenCode** — MCP mailbox + Chrome/Firefox automation + Jayden-style skills install.

## Install (Jayden-style, multiplatform)

**Linux / macOS / WSL**
```bash
./install.sh              # install MCP + skills + browsers
./install.sh --run        # install, then headless hub API + relay
./run.sh                  # headless by default (no windows)
./run.sh --headed --once  # one-time visible login into persistent profile
./run.sh --site chatgpt --peer claude
```

**Windows native**
```bat
install.cmd
install.cmd --run
run.cmd
```
```powershell
.\install.ps1 --run
.\run.ps1 --site chatgpt
```

Install **automatically**:
- MCP into Cursor / Claude Code / OpenCode / …
- Skills (`mailnotmilk-bridge`, `browser-relay`) project + user-level
- **Playwright + Chromium / Firefox / WebKit** (no manual `npx playwright install`)

| Platform | Entrypoint | Browsers |
|----------|------------|----------|
| Linux native | `./install.sh` | chromium, firefox, webkit + `install-deps` (best-effort) |
| Windows WSL | `./install.sh` | same (+ WSLg note for headed UI) |
| macOS | `./install.sh` | chromium, firefox, webkit |
| Windows native | `install.cmd` / `install.ps1` | chromium, firefox, webkit |

Skip browsers: `--skip-browsers`. Browsers only: `mailnotmilk install --browsers-only`.
Skip OS libs: `--skip-deps`. Force OS libs: `--with-deps`.

## Browser AI ↔ coding agent

```bash
mailnotmilk hub &
mailnotmilk relay --site deepseek --peer claude --browser chrome --wait 20000
# or firefox: --browser firefox
```

Flow:

1. Playwright opens DeepSeek/ChatGPT/… (Chrome or Firefox)
2. Extracts chat turns from the page
3. Forwards into a mailnotmilk chat for Claude/Cursor/OpenCode
4. When the coding agent replies, types it back into the browser composer

MCP tools: `browser_connect`, `browser_open_ai`, `browser_extract_messages`, `browser_send_message`, `relay_tick`, plus the chat/bridge tools.

Skills installed: `mailnotmilk-bridge`, `browser-relay`.

## DeepSeek-in-Cursor → Claude Code (paste)

Still works when the “browser” is Cursor itself:

```bash
mailnotmilk bridge -t "fix auth" -m "help me" --open
```

Paste the block into Claude Code.

## License

MIT
