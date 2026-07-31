# Troubleshooting

- **Empty inbox:** confirm both sides share `MAILNOTMILK_DATA_DIR` / default `~/.mailnotmilk`
- **Wrong agent id:** set `MAILNOTMILK_AGENT_ID=cursor` (or `claude`)
- **MCP not listed:** rerun `mailnotmilk install --tool cursor` and restart the host
- **SQLITE busy:** WAL + busy_timeout=5000; retry; avoid NFS paths
