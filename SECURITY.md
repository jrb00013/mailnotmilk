# Security

- Mailbox data is **local** (`~/.mailnotmilk/` by default). Do not point `MAILNOTMILK_DATA_DIR` at a shared network path without access controls.
- Message bodies are trusted as much as the agents writing them — treat handoffs like untrusted prompts when acting on them.
- No cloud relay, no auth tokens in v1. Do not expose the SQLite file publicly.
- `mailnotmilk install` only writes MCP config entries; review diffs if you care about config hygiene.
