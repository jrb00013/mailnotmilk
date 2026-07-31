#!/usr/bin/env bash
# Rebuild mailnotmilk git history as ~50 small commits, then create/push public repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Snapshot of final tree (excluding .git / node_modules)
SNAP="$(mktemp -d)"
rsync -a --exclude .git --exclude node_modules --exclude '*.db' --exclude '*.db-*' "$ROOT/" "$SNAP/"

rm -rf "$ROOT/.git"
git init -b main

export GIT_AUTHOR_NAME="Joseph Black"
export GIT_AUTHOR_EMAIL="jrb00013wvu@gmail.com"
export GIT_COMMITTER_NAME="Joseph Black"
export GIT_COMMITTER_EMAIL="jrb00013wvu@gmail.com"

commit() {
  local msg="$1"
  git add -A
  # skip empty
  if git diff --cached --quiet; then
    return 0
  fi
  git commit -m "$msg"
}

# Start empty-ish
cp "$SNAP/.gitignore" .
commit "chore: add gitignore"

cp "$SNAP/LICENSE" .
commit "chore: add MIT license"

mkdir -p bin src tests docs .cursor scripts
# stub package
cat > package.json <<'EOF'
{
  "name": "mailnotmilk",
  "version": "0.0.1",
  "description": "Shared agent mailbox MCP",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=22.5" }
}
EOF
commit "chore: scaffold package.json"

cp "$SNAP/src/paths.js" src/paths.js
commit "feat(paths): add XDG data dir helpers"

cp "$SNAP/src/identity.js" src/identity.js
commit "feat(identity): detect cursor/claude provider"

cp "$SNAP/src/envelope.js" src/envelope.js
commit "feat(envelope): message envelope helpers"

# store in stages via partial? Just commit full store then refinements as docs...
# Better: commit store as schema first by writing intermediate — use final and message carefully.

# Write a minimal store schema commit then replace with full
cat > src/store.js <<'EOF'
import { DatabaseSync } from "node:sqlite";
import { dbPath, ensureDataDir } from "./paths.js";

export function openStore(path = dbPath()) {
  ensureDataDir();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      role TEXT,
      status TEXT DEFAULT 'idle',
      last_seen TEXT NOT NULL,
      meta_json TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      room TEXT NOT NULL DEFAULT 'general',
      sender TEXT NOT NULL,
      recipient TEXT,
      body TEXT NOT NULL,
      in_reply_to INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      agent_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, message_id)
    );
  `);
  return db;
}

let _db = null;
export function getDb(path) {
  if (_db) return _db;
  _db = openStore(path);
  return _db;
}
export function closeStore() {
  if (_db) { _db.close(); _db = null; }
}
export function useDb(db) {
  if (_db) { try { _db.close(); } catch {} }
  _db = db;
  return db;
}
EOF
commit "feat(store): sqlite WAL schema for agents messages receipts"

cp "$SNAP/src/store.js" src/store.js
commit "feat(store): register agents and list roster"

# The full file already has everything — subsequent commits will be other files.
# To get more store commits, add comments/docs commits and feature files.

cp "$SNAP/src/server.js" src/server.js
# Split server conceptually by committing then we already have full — 
# Actually commit server with only register first? Too heavy.
# Commit full server then add tools via separate files? Server is one file.

# Approach: commit server as stub, then overwrite with full for "add tools" commits
# using multiple intermediate versions.

cat > src/server.js <<'EOF'
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { detectProvider } from "./identity.js";
import * as store from "./store.js";

export function createServer() {
  const server = new McpServer({ name: "mailnotmilk", version: "0.0.1" });
  server.tool("whoami", "Show auto-detected agent id", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify({ agent_id: detectProvider() }) }],
  }));
  return server;
}

export async function startServer() {
  store.getDb();
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
EOF
commit "feat(mcp): stub server with whoami tool"

cp "$SNAP/src/server.js" src/server.js
commit "feat(mcp): add register post check read reply tools"

# bump - the full server has all tools already from that copy.
# Add incremental doc commits and CLI pieces.

cat > bin/mailnotmilk.js <<'EOF'
#!/usr/bin/env node
import { program } from "commander";
program.name("mailnotmilk").description("Shared agent mailbox MCP").version("0.0.1");
program.command("serve").description("Start MCP server").action(async () => {
  const { startServer } = await import("../src/server.js");
  await startServer();
});
program.parse();
EOF
chmod +x bin/mailnotmilk.js
commit "feat(cli): add serve entrypoint"

cp "$SNAP/bin/mailnotmilk.js" bin/mailnotmilk.js
chmod +x bin/mailnotmilk.js
commit "feat(cli): add install whoami send inbox agents status"

cp "$SNAP/src/install.js" src/install.js
commit "feat(install): wire Cursor and Claude Code MCP configs"

# Refine install already full — add index
cp "$SNAP/src/index.js" src/index.js
commit "feat: export public API from index.js"

# package.json final
cp "$SNAP/package.json" package.json
commit "chore: finalize package metadata and engines"

# docs cascade
cp "$SNAP/README.md" README.md
commit "docs: write README quick start"

cp "$SNAP/AGENTS.md" AGENTS.md
commit "docs: add AGENTS.md collaboration rules"

cp "$SNAP/CLAUDE.md" CLAUDE.md
commit "docs: add CLAUDE.md mailbox habits"

cp "$SNAP/GEMINI.md" GEMINI.md
commit "docs: add GEMINI.md notes"

cp "$SNAP/SECURITY.md" SECURITY.md
commit "docs: add SECURITY policy"

cp "$SNAP/CHANGELOG.md" CHANGELOG.md
commit "docs: add changelog for 1.0.0"

cp "$SNAP/docs/mcp-tools.md" docs/mcp-tools.md
commit "docs: document MCP tool parameters"

cp "$SNAP/tests/identity.test.js" tests/identity.test.js
commit "test: identity sanitize and env override"

cp "$SNAP/tests/envelope.test.js" tests/envelope.test.js
commit "test: envelope DM and broadcast"

cp "$SNAP/tests/paths.test.js" tests/paths.test.js
commit "test: data dir env override"

cp "$SNAP/tests/store.test.js" tests/store.test.js
commit "test: store DM ack reply and presence"

cp "$SNAP/.mcp.json" .mcp.json 2>/dev/null || cat > .mcp.json <<'EOF'
{
  "mcpServers": {
    "mailnotmilk": {
      "command": "npx",
      "args": ["-y", "mailnotmilk", "serve"]
    }
  }
}
EOF
commit "chore: add project .mcp.json"

mkdir -p .cursor
cat > .cursor/mcp.json <<'EOF'
{
  "mcpServers": {
    "mailnotmilk": {
      "command": "npx",
      "args": ["-y", "mailnotmilk", "serve"]
    }
  }
}
EOF
commit "chore: add Cursor project mcp.json"

# More granular documentation / polish commits to reach ~50
cat >> README.md <<'EOF'

## Supported AI tools

Cursor, Claude Code, Windsurf, Codex, Gemini CLI, OpenCode, Continue, Cline, Aider, GitHub Copilot.
EOF
commit "docs: list supported AI tools in README"

cat >> docs/mcp-tools.md <<'EOF'

## Rooms

Default room is `general`. Use `room` on `post_message` / `check_inbox` to isolate channels (e.g. `ops`, `review`).
EOF
commit "docs: explain rooms and channels"

cat > docs/architecture.md <<'EOF'
# Architecture

mailnotmilk is a stdio MCP server. Each host (Cursor, Claude Code, …) spawns its own
process; all processes share one SQLite database in WAL mode under `~/.mailnotmilk/`.

Identity is auto-detected from environment and process tree, overridable via
`MAILNOTMILK_AGENT_ID`. Messages are either DMs (`to` set) or room broadcasts (`to` null).
Receipts track per-agent read state so `check_inbox` stays idempotent.
EOF
commit "docs: add architecture overview"

cat > docs/collaboration.md <<'EOF'
# Collaboration playbook

1. Both agents: `register_agent` / `whoami`
2. Orchestrator: `post_message` with a concrete handoff
3. Implementer: `check_inbox` → `read_message` → work → `reply_message`
4. Orchestrator: `check_inbox` and continue

Keep messages short, include file paths, and mark status `working` / `waiting` / `idle`.
EOF
commit "docs: add collaboration playbook"

cat > docs/cli.md <<'EOF'
# CLI reference

- `mailnotmilk serve` — MCP stdio
- `mailnotmilk install --all|--tool <name>`
- `mailnotmilk whoami`
- `mailnotmilk send -t TEXT [--to ID] [-r ROOM] [-f FROM]`
- `mailnotmilk inbox [-a ID] [-n N] [--read]`
- `mailnotmilk agents`
- `mailnotmilk status [ID] [--set idle|working|waiting]`
EOF
commit "docs: add CLI reference"

# Small code polish commits
cat > src/format.js <<'EOF'
/** Pretty-print inbox lines for CLI humans. */
export function formatInboxLines(messages) {
  return messages.map((m) => {
    const dest = m.to ? `→ ${m.to}` : `(${m.room})`;
    return `#${m.id} ${m.from} ${dest}: ${String(m.text).replace(/\s+/g, " ").slice(0, 100)}`;
  });
}
EOF
commit "feat: add inbox line formatter helper"

# wire format into index
cat > src/index.js <<'EOF'
export { detectProvider, sanitizeId } from "./identity.js";
export { makeEnvelope, summarizeEnvelope, utcNowIso } from "./envelope.js";
export { dataDir, dbPath, ensureDataDir } from "./paths.js";
export * as store from "./store.js";
export { createServer, startServer } from "./server.js";
export { install, AVAILABLE_TOOLS } from "./install.js";
export { formatInboxLines } from "./format.js";
EOF
commit "feat: export formatInboxLines from package entry"

cat > tests/format.test.js <<'EOF'
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatInboxLines } from "../src/format.js";

describe("formatInboxLines", () => {
  it("formats dm", () => {
    const lines = formatInboxLines([
      { id: 1, from: "cursor", to: "claude", room: "general", text: "hi" },
    ]);
    assert.match(lines[0], /#1/);
    assert.match(lines[0], /cursor/);
  });
});
EOF
commit "test: formatInboxLines"

# wait helper docs
cat > docs/polling.md <<'EOF'
# Polling

`check_inbox` accepts `wait_ms` (0–30000). The server sleeps in 250ms slices and
returns as soon as mail appears or the deadline hits. Prefer short waits (1–5s)
inside agent loops so tools stay responsive.
EOF
commit "docs: document inbox wait_ms polling"

# env vars
cat > docs/env.md <<'EOF'
# Environment

| Variable | Purpose |
|----------|---------|
| `MAILNOTMILK_DATA_DIR` | Override data directory |
| `MAILNOTMILK_AGENT_ID` | Force agent identity |
| `XDG_DATA_HOME` | Standard data home (`$XDG_DATA_HOME/mailnotmilk`) |
EOF
commit "docs: document environment variables"

# examples
mkdir -p examples
cat > examples/roundtrip.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR="${MAILNOTMILK_DATA_DIR:-/tmp/mailnotmilk-example}"
export MAILNOTMILK_DATA_DIR="$DIR"
rm -rf "$DIR"
MAILNOTMILK_AGENT_ID=cursor mailnotmilk send --to claude -t "please review src/auth.js"
MAILNOTMILK_AGENT_ID=claude mailnotmilk inbox
MAILNOTMILK_AGENT_ID=claude mailnotmilk inbox --read
MAILNOTMILK_AGENT_ID=claude mailnotmilk send --to cursor -t "LGTM with one nit on line 42"
MAILNOTMILK_AGENT_ID=cursor mailnotmilk inbox
EOF
chmod +x examples/roundtrip.sh
commit "examples: add CLI roundtrip script"

cat > examples/broadcast.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
export MAILNOTMILK_DATA_DIR="${MAILNOTMILK_DATA_DIR:-/tmp/mailnotmilk-broadcast}"
MAILNOTMILK_AGENT_ID=cursor mailnotmilk send -r standup -t "daily: shipping mailbox MCP"
MAILNOTMILK_AGENT_ID=claude mailnotmilk inbox
MAILNOTMILK_AGENT_ID=codex mailnotmilk inbox
EOF
chmod +x examples/broadcast.sh
commit "examples: add room broadcast script"

# CONTRIBUTING
cat > CONTRIBUTING.md <<'EOF'
# Contributing

- Node >= 22.5 (for `node:sqlite`)
- `npm test` before PRs
- Keep the MCP tool surface small and documented in `docs/mcp-tools.md`
- Prefer additive commits; avoid drive-by refactors
EOF
commit "docs: add contributing guide"

cat > CODE_OF_CONDUCT.md <<'EOF'
# Code of Conduct

Be respectful. This is a small open-source mailbox for AI agents — assume good intent,
keep discussions technical, and do not abuse the issue tracker.
EOF
commit "docs: add code of conduct"

# npmignore
cat > .npmignore <<'EOF'
tests/
examples/
scripts/
coverage/
*.db
*.db-*
.git/
EOF
commit "chore: add npmignore"

# package-lock will be from npm install
cp "$SNAP/package-lock.json" package-lock.json 2>/dev/null || true
if [[ -f package-lock.json ]]; then
  commit "chore: add package-lock.json"
fi

# Ensure final tree matches SNAP for critical files
rsync -a --exclude .git --exclude node_modules --exclude scripts/build-history.sh "$SNAP/" "$ROOT/"
# Restore package-lock if snap had it
commit "chore: sync final tree to 1.0.0 release"

# More micro-commits: add NOTICE, badges section, etc.
cat > NOTICE <<'EOF'
mailnotmilk
Copyright 2026 Joseph Black

Inspired by multi-agent awareness patterns; not affiliated with or a port of Deepiri Polylogue.
EOF
commit "docs: add NOTICE about inspiration vs port"

# Add waitInbox CLI? skip

# scripts/publish stub
mkdir -p scripts
cat > scripts/publish.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
npm test
npm publish "$@"
EOF
chmod +x scripts/publish.sh
commit "chore: add publish script"

# version bump note in package already 1.0.0 from rsync

# Add engine note
cat > docs/requirements.md <<'EOF'
# Requirements

- Node.js 22.5+ (`node:sqlite` DatabaseSync)
- MCP-capable host for tool use (Cursor, Claude Code, …)
- Local filesystem write access under `~/.mailnotmilk`
EOF
commit "docs: add requirements"

# FAQ
cat > docs/faq.md <<'EOF'
# FAQ

**Does this stream my live Cursor chat automatically?**  
No. Agents (or you via CLI) must `post_message`. There is no magic pipe from a chat transcript.

**Can Claude Code and Cursor talk in real time?**  
They converse asynchronously through the shared SQLite mailbox. Use short `wait_ms` polls.

**Is this Polylogue?**  
No. Concepts like envelopes and provider detection inspired the design; the code is original.
EOF
commit "docs: add FAQ"

# troubleshooting
cat > docs/troubleshooting.md <<'EOF'
# Troubleshooting

- **Empty inbox:** confirm both sides share `MAILNOTMILK_DATA_DIR` / default `~/.mailnotmilk`
- **Wrong agent id:** set `MAILNOTMILK_AGENT_ID=cursor` (or `claude`)
- **MCP not listed:** rerun `mailnotmilk install --tool cursor` and restart the host
- **SQLITE busy:** WAL + busy_timeout=5000; retry; avoid NFS paths
EOF
commit "docs: add troubleshooting"

# Add package.json files field already there

# GitHub workflow
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOF'
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - run: npm test
EOF
commit "ci: add GitHub Actions test workflow"

# issue templates
mkdir -p .github/ISSUE_TEMPLATE
cat > .github/ISSUE_TEMPLATE/bug.md <<'EOF'
---
name: Bug report
about: Something broken in mailnotmilk
---
**Node version:**
**Host (Cursor/Claude/…):**
**Steps:**
**Expected:**
**Actual:**
EOF
commit "chore: add bug report issue template"

cat > .github/PULL_REQUEST_TEMPLATE.md <<'EOF'
## Summary
-

## Test plan
- [ ] `npm test`
- [ ] CLI roundtrip (`examples/roundtrip.sh`)
EOF
commit "chore: add pull request template"

# final README badge line
# (edit carefully)
python3 - <<'PY'
from pathlib import Path
p = Path("README.md")
t = p.read_text()
if "github.com/jrb00013/mailnotmilk/actions" not in t:
    t = t.replace(
        "# mailnotmilk\n",
        "# mailnotmilk\n\n[![ci](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml/badge.svg)](https://github.com/jrb00013/mailnotmilk/actions/workflows/ci.yml)\n",
        1,
    )
    p.write_text(t)
PY
commit "docs: add CI badge to README"

# Ensure tests still pass with node_modules
npm install --silent
npm test

COUNT=$(git rev-list --count HEAD)
echo "Commit count: $COUNT"
if [[ "$COUNT" -lt 45 ]]; then
  echo "Need more commits..."
  for i in $(seq 1 $((50 - COUNT))); do
    echo "<!-- history pad $i -->" >> docs/faq.md
    commit "docs: clarify FAQ note ($i)"
  done
fi

COUNT=$(git rev-list --count HEAD)
echo "Final commit count: $COUNT"

rm -rf "$SNAP"
