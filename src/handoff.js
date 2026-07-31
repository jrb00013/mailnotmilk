/**
 * Build a structured handoff body + meta without touching the DB.
 */
export function buildHandoffMarkdown({
  title,
  objective,
  context = "",
  acceptance = [],
  files = [],
}) {
  if (!title || !objective) throw new Error("handoff requires title and objective");
  return [
    `# Handoff: ${title}`,
    "",
    `**Objective:** ${objective}`,
    context ? `\n## Context\n${context}` : "",
    acceptance?.length
      ? `\n## Acceptance\n${acceptance.map((a) => `- ${a}`).join("\n")}`
      : "",
    files?.length
      ? `\n## Files\n${files.map((f) => `- \`${f}\``).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseHandoffMeta(message) {
  return message?.meta?.handoff || null;
}
