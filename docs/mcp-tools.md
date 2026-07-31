# mailnotmilk MCP tools (v1.4)

## Browser relay
- `browser_connect` — chrome/firefox, launch or CDP
- `browser_open_ai` — chatgpt|deepseek|claude|gemini|copilot|url
- `browser_extract_messages` / `browser_send_message` / `browser_screenshot`
- `browser_status` / `browser_disconnect`
- `relay_tick` — browser ↔ mailnotmilk coding agent one cycle

## Chats (preferred for paste bridges)
| Tool | Purpose |
|------|---------|
| `create_chat` / `bridge_to_claude` | Join link + peer prompt |
| `join_chat` / `chat_link` / `chat_say` / `chat_history` / `list_chats` | Chat ops |

## Messaging / inbox
`post_message`, `post_handoff`, `post_turn`, `check_inbox`, `read_message`, `reply_message`, `get_thread`, `search_messages`, …

Install: `./install.sh install --tools all --skills --global-skills`
