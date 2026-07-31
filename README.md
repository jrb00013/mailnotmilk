# mailnotmilk

[![ci](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml/badge.svg)](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml)

Bridge **any browser AI** (ChatGPT, DeepSeek web, Gemini, Copilot, Claude.ai) with **Claude Code / Cursor / OpenCode** — MCP mailbox + Chrome/Firefox automation + Jayden-style skills install.

## Install (Jayden-style)

```bash
git clone https://github.com/jrb00013/mailnotmilk.git
cd mailnotmilk
./install.sh install --tools all --skills --global-skills --target .
# same as:
# mailnotmilk install --tools all --skills --global-skills --target .
```

This writes:

| Provider | MCP | Skills |
|----------|-----|--------|
| Cursor | `~/.cursor/mcp.json` + project `.cursor/mcp.json` | `.cursor/skills/*/SKILL.md` |
| Claude Code | `~/.claude/settings.json` | `.claude/skills/*/SKILL.md` |
| OpenCode | `~/.config/opencode/opencode.json` | `.opencode/skills/*/SKILL.md` |
| Gemini / Copilot | settings / instructions | matching skill dirs |

Browser automation:

```bash
npm i
npx playwright install chromium firefox
```

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
