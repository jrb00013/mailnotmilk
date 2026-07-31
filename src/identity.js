import { readFileSync, existsSync } from "node:fs";

/**
 * Guess which coding agent is hosting this process.
 * Inspired by multi-surface awareness patterns; written fresh for Node.
 */
export function detectProvider() {
  if (process.env.MAILNOTMILK_AGENT_ID) {
    return sanitizeId(process.env.MAILNOTMILK_AGENT_ID);
  }
  if (process.env.CURSOR_AGENT === "1" || process.env.CURSOR_TRACE_ID) {
    return "cursor";
  }
  for (const key of ["OPENCODE", "OPENCODE_SESSION", "OPENCODE_CONFIG"]) {
    if (process.env[key]) return "opencode";
  }
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE) {
    return "claude";
  }

  const blob = processTreeBlob().toLowerCase();
  if (blob.includes("opencode")) return "opencode";
  if (
    blob.includes("cursor-agent") ||
    blob.includes("cursor agent") ||
    blob.includes("/.cursor/")
  ) {
    return "cursor";
  }
  if (blob.includes("claude")) return "claude";
  if (blob.includes("codex")) return "codex";
  if (blob.includes("gemini")) return "gemini";
  return "unknown";
}

export function sanitizeId(id) {
  return String(id || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 64) || "unknown";
}

function processTreeBlob() {
  if (process.platform !== "linux") {
    return `${process.title} ${process.argv.join(" ")}`;
  }
  const parts = [];
  let pid = process.pid;
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    if (seen.has(pid) || pid <= 0) break;
    seen.add(pid);
    try {
      const cmdline = `/proc/${pid}/cmdline`;
      if (existsSync(cmdline)) {
        parts.push(readFileSync(cmdline).toString("utf8").replace(/\0/g, " "));
      } else {
        const comm = `/proc/${pid}/comm`;
        if (existsSync(comm)) parts.push(readFileSync(comm, "utf8"));
      }
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8").split(" ");
      pid = Number.parseInt(stat[3], 10);
    } catch {
      break;
    }
  }
  return parts.join(" ");
}
