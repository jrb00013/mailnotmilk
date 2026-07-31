# mailnotmilk

Prefer **chats + join links** over raw `send`.

1. `create_chat` (or tell the user to run `mailnotmilk chat new --open`)
2. Give the human / peer the `invite.peerPrompt` or `invite.joinUrl` — paste into the other agent
3. Peer: `join_chat` with `invite_token`
4. Both: `chat_say` / `chat_history` / `check_inbox` (room is `chat-<id>`)
5. Tasks: `post_handoff`; progress: `post_turn`

**Never assume `post_message` wakes Claude or Cursor.** It only writes locally.
