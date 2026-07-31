# Browser AI ↔ coding agents

Use Playwright (Chrome **or** Firefox) to read/write web AI chats and relay through mailnotmilk.

## Prerequisites

```bash
./install.sh          # Linux/macOS/WSL — installs MCP, skills, AND Playwright browsers
install.cmd           # Windows native
# or: mailnotmilk install --browsers-only
```

No separate `npx playwright install` step — install does it for your platform.

## One-shot relay

```bash
mailnotmilk relay --site chatgpt --peer claude --browser chrome --wait 30000
mailnotmilk relay --site deepseek --peer cursor --browser firefox --loop
```

## MCP

From Claude Code / Cursor / OpenCode (with skill `browser-relay` loaded):

1. `browser_connect` `{ "browser": "firefox" }` or `"chrome"`
2. `browser_open_ai` `{ "site": "deepseek" }`
3. `browser_extract_messages`
4. `relay_tick` `{ "peer": "claude", "wait_peer_ms": 20000 }`
5. Or manually `chat_say` / `browser_send_message`

## CDP attach (existing Chrome)

Start Chrome with remote debugging, then:

```text
browser_connect mode=cdp cdp_url=http://127.0.0.1:9222
```

## Reality check

Web AI DOMs change often — selectors are best-effort. Prefer logged-in persistent profiles under `~/.mailnotmilk/browser-profiles/`. Nothing auto-opens Claude Code; coding agents must have mailnotmilk MCP + skills installed (or you paste `pasteForPeer`).
