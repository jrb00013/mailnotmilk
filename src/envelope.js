/**
 * Lightweight message envelopes for the shared mailbox.
 * Shape is intentionally simple so any agent can read JSON without a schema registry.
 */

export function utcNowIso() {
  return new Date().toISOString();
}

/**
 * @param {object} opts
 * @param {string} opts.type - e.g. "message" | "reply" | "system"
 * @param {string} opts.from
 * @param {string} [opts.to] - omit for room broadcast
 * @param {string} [opts.room]
 * @param {string} opts.text
 * @param {string} [opts.inReplyTo]
 * @param {Record<string, unknown>} [opts.extra]
 */
export function makeEnvelope({
  type = "message",
  from,
  to = null,
  room = "general",
  text,
  inReplyTo = null,
  extra = {},
}) {
  if (!from) throw new Error("envelope requires from");
  if (text == null || text === "") throw new Error("envelope requires text");
  return {
    type,
    room: room || "general",
    from,
    to: to || null,
    ts: utcNowIso(),
    text: String(text),
    in_reply_to: inReplyTo || null,
    ...extra,
  };
}

export function summarizeEnvelope(env) {
  const to = env.to ? ` → ${env.to}` : " (broadcast)";
  const preview = String(env.text).replace(/\s+/g, " ").slice(0, 120);
  return `[${env.id || "?"}] ${env.from}${to} @${env.room}: ${preview}`;
}
