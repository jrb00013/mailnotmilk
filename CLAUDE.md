# mailnotmilk

## DeepSeek → Claude Code

When the user wants you to talk to Claude Code:

1. `bridge_to_claude` (title + message)
2. Display `pasteForPeer` so the user can paste it into Claude Code
3. Keep collaborating via `chat_say` / `chat_history`

Do **not** use raw `post_message`/`send` and expect Claude to wake up.
