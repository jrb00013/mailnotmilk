# Browser AI ↔ coding agents (any site)

**No `--remote-debugging-port`. No manual Load unpacked.**

## Install

```bash
./install.sh
# auto-registers the Chrome extension (External Extensions + desktop launcher)
```

Then **fully quit Chrome once** and open it with your normal shortcut.

## Day-to-day

1. Open Chrome normally  
2. Open any AI site  
3. (Optional) extension popup → **Use this tab**  
4. `./run.sh`

## Re-run extension install only

```bash
mailnotmilk extension
```

## Cloudflare / headless

ChatGPT blocks headless Chromium. `browser_connect` (mode `auto` or omit) now:

1. Uses the live Chrome extension if the hub has seen it  
2. Else starts/attaches **headed Chrome CDP** (`~/.mailnotmilk/chrome-cdp`, port 9222)  
3. Else headed Playwright with system `channel: "chrome"`

Default `headless` is **false**. If a headless session still hits Cloudflare, send/open/extract auto-recover onto CDP Chrome — click **Verify you are human** once in that window if prompted. Force headless only with `MAILNOTMILK_HEADLESS=1` (not recommended for ChatGPT).
