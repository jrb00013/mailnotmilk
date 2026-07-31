# mailnotmilk

Skills: **mailnotmilk-bridge**, **browser-relay** (installed via `./install.sh`).

## Browser AI (GPT / DeepSeek web / …) ↔ Claude / Cursor / OpenCode

1. `browser_connect` (chrome or firefox)
2. `browser_open_ai` + `browser_extract_messages`
3. `relay_tick` (forwards into mailnotmilk chat; paste `pasteForPeer` into coding agent if needed)
4. Peer replies with `chat_say`; relay types back into the browser

Or CLI: `mailnotmilk relay --site deepseek --peer claude --browser firefox`

## Cursor DeepSeek model → Claude Code

`bridge_to_claude` → show `pasteForPeer` to the human.
