/** Pretty-print inbox lines for CLI humans. */
export function formatInboxLines(messages) {
  return messages.map((m) => {
    const dest = m.to ? `→ ${m.to}` : `(${m.room})`;
    return `#${m.id} ${m.from} ${dest}: ${String(m.text).replace(/\s+/g, " ").slice(0, 100)}`;
  });
}
