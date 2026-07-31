# Architecture

mailnotmilk is a stdio MCP server. Each host (Cursor, Claude Code, …) spawns its own
process; all processes share one SQLite database in WAL mode under `~/.mailnotmilk/`.

Identity is auto-detected from environment and process tree, overridable via
`MAILNOTMILK_AGENT_ID`. Messages are either DMs (`to` set) or room broadcasts (`to` null).
Receipts track per-agent read state so `check_inbox` stays idempotent.
