import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { detectProvider } from "./identity.js";
import * as store from "./store.js";

/**
 * Post a "turn summary" so peers can see what this agent just did.
 * Agents / hooks call this at end of a turn.
 */
export function postTurn({
  from = detectProvider(),
  to = null,
  room = "general",
  summary,
  files = [],
  outcome = "progress",
} = {}) {
  if (!summary) throw new Error("postTurn requires summary");
  const text = [
    `## Turn (${outcome})`,
    "",
    summary,
    files?.length ? `\nFiles:\n${files.map((f) => `- \`${f}\``).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return store.postMessage({
    from,
    to,
    room,
    text,
    type: "turn",
    tags: ["turn", outcome],
    attachments: (files || []).map((path) => ({ type: "path", path })),
    meta: { turn: { outcome, files } },
  });
}

/** Write Cursor-style hook snippets into a project. */
export function installCursorHooks(projectRoot = process.cwd()) {
  const hooksDir = join(projectRoot, ".cursor", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const script = join(hooksDir, "mailnotmilk-turn.sh");
  writeFileSync(
    script,
    `#!/usr/bin/env bash
# Optional: call from a Cursor hook / agent instruction to announce a turn.
# Usage: mailnotmilk-turn.sh "what I did" [to-agent]
set -euo pipefail
SUMMARY="\${1:?summary required}"
TO="\${2:-}"
if [[ -n "\$TO" ]]; then
  mailnotmilk turn -t "\$SUMMARY" --to "\$TO"
else
  mailnotmilk turn -t "\$SUMMARY"
fi
`,
    { mode: 0o755 }
  );
  const note = join(hooksDir, "mailnotmilk.md");
  writeFileSync(
    note,
    `# mailnotmilk turn hook

After finishing a collaborative turn, post a summary:

\`\`\`bash
.cursor/hooks/mailnotmilk-turn.sh "Implemented X; waiting on review" claude
\`\`\`

Or via MCP: \`post_turn\` with summary + optional \`to\`.
`
  );
  return { script, note };
}

/** Append Claude Code stop-hook hint into settings if missing. */
export function installClaudeStopHint() {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  mkdirSync(join(homedir(), ".claude"), { recursive: true });
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      settings = {};
    }
  }
  // Document-only: Claude Code hook schemas vary; write a sibling file.
  const hint = join(homedir(), ".claude", "mailnotmilk-hooks.md");
  writeFileSync(
    hint,
    `# mailnotmilk + Claude Code

When collaborating via mailnotmilk, at the end of a turn run:

\`\`\`bash
mailnotmilk turn -t "Done: <summary>" --to cursor
# or
mailnotmilk handoff --to cursor --title "Review" --objective "Review the diff"
\`\`\`

Keep \`check_inbox\` in your loop. Slash command: \`/mailbox\`.
`
  );
  return { settingsPath, hint, settingsPresent: existsSync(settingsPath) };
}

export function appendLocalLog(line) {
  const dir = join(homedir(), ".mailnotmilk");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "turns.log"), `${new Date().toISOString()} ${line}\n`);
}
