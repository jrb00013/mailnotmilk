import { formatInboxLines } from "./format.js";
import * as store from "./store.js";

/** Render a terminal status board. */
export function renderBoard(data = store.board()) {
  const lines = [];
  lines.push("╔══════════════════════════════════════════╗");
  lines.push("║           mailnotmilk board              ║");
  lines.push("╚══════════════════════════════════════════╝");
  lines.push("");
  lines.push("Agents:");
  if (!data.agents.length) lines.push("  (none recently)");
  for (const a of data.agents) {
    lines.push(`  • ${a.id.padEnd(12)} ${a.status.padEnd(8)} seen ${a.lastSeen}`);
  }
  lines.push("");
  lines.push("Rooms:");
  for (const r of data.rooms.slice(0, 10)) {
    lines.push(`  #${r.room}  ${r.messageCount} msgs  last ${r.lastActivity}`);
  }
  if (!data.rooms.length) lines.push("  (empty)");
  lines.push("");
  lines.push("Urgent / high:");
  if (!data.urgent.length) lines.push("  (none)");
  else lines.push(...formatInboxLines(data.urgent).map((l) => `  ${l}`));
  lines.push("");
  lines.push("Recent:");
  if (!data.recent.length) lines.push("  (none)");
  else lines.push(...formatInboxLines(data.recent).map((l) => `  ${l}`));
  lines.push("");
  const s = data.stats;
  lines.push(
    `Stats: ${s.messages} msgs · ${s.agents} agents · ${s.rooms} rooms · ${s.neverAcked} never-acked`
  );
  return lines.join("\n");
}
