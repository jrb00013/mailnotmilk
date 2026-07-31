# Browser AI ↔ coding agents (any site)

**No `--remote-debugging-port`.** Use your normal Chrome shortcut.

## One-time: install the extension

```bash
mailnotmilk extension
# or:
# chrome://extensions → Developer mode → Load unpacked →
#   /path/to/mailnotmilk/extension
```

## Day-to-day

1. Open Chrome normally (dock/taskbar shortcut — no flags)
2. Open **any** AI site (ChatGPT, DeepSeek, Gemini, Claude.ai, Copilot, …)
3. Click the **mailnotmilk** extension → **Use this tab**
4. Run:
   ```bash
   ./run.sh
   # or --site deepseek / gemini / etc.
   ```

The hub stays in the background. The extension drives the tab you picked.

## MCP (in Cursor / Claude Code / …)

`browser_connect` `{ "mode": "extension" }` then `browser_open_ai` / `chat_say` / `relay_tick`.

## Fallbacks

If the extension isn’t connected, mailnotmilk may try CDP or Playwright. Prefer the extension path.
