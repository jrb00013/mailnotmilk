import { DatabaseSync } from "node:sqlite";
import { dbPath, ensureDataDir } from "./paths.js";
import { makeEnvelope, utcNowIso } from "./envelope.js";
import { sanitizeId } from "./identity.js";

let _db = null;

export function openStore(path = dbPath()) {
  ensureDataDir();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
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
      created_at TEXT NOT NULL,
      FOREIGN KEY (in_reply_to) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS receipts (
      agent_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, message_id),
      FOREIGN KEY (message_id) REFERENCES messages(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient);
    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  `);
  return db;
}

export function getDb(path) {
  if (_db) return _db;
  _db = openStore(path);
  return _db;
}

export function closeStore() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** Use an isolated DB (tests). Resets the module singleton. */
export function useDb(db) {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
  }
  _db = db;
  return db;
}

export function registerAgent({
  id,
  displayName = null,
  role = null,
  status = "idle",
  meta = {},
} = {}) {
  const agentId = sanitizeId(id);
  if (!agentId || agentId === "unknown") {
    throw new Error("register_agent requires a usable id");
  }
  const now = utcNowIso();
  const db = getDb();
  db.prepare(
    `INSERT INTO agents (id, display_name, role, status, last_seen, meta_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, agents.display_name),
       role = COALESCE(excluded.role, agents.role),
       status = excluded.status,
       last_seen = excluded.last_seen,
       meta_json = excluded.meta_json`
  ).run(
    agentId,
    displayName || agentId,
    role || agentId,
    status || "idle",
    now,
    JSON.stringify(meta || {})
  );
  return getAgent(agentId);
}

export function getAgent(id) {
  const row = getDb()
    .prepare(`SELECT * FROM agents WHERE id = ?`)
    .get(sanitizeId(id));
  return row ? mapAgent(row) : null;
}

export function listAgents({ sinceMinutes = 60 * 24 } = {}) {
  const cutoff = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT * FROM agents WHERE last_seen >= ? ORDER BY last_seen DESC`
    )
    .all(cutoff);
  return rows.map(mapAgent);
}

export function setStatus(id, status) {
  const agentId = sanitizeId(id);
  const now = utcNowIso();
  getDb()
    .prepare(
      `INSERT INTO agents (id, display_name, role, status, last_seen, meta_json)
       VALUES (?, ?, ?, ?, ?, '{}')
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, last_seen = excluded.last_seen`
    )
    .run(agentId, agentId, agentId, status, now);
  return getAgent(agentId);
}

export function getStatus(id) {
  const agent = getAgent(id);
  return agent ? { id: agent.id, status: agent.status, lastSeen: agent.lastSeen } : null;
}

export function postMessage({
  from,
  to = null,
  room = "general",
  text,
  type = "message",
  inReplyTo = null,
}) {
  const envelope = makeEnvelope({
    type,
    from: sanitizeId(from),
    to: to ? sanitizeId(to) : null,
    room: room || "general",
    text,
    inReplyTo,
  });
  // ensure sender exists
  registerAgent({ id: envelope.from, status: "working" });
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO messages (type, room, sender, recipient, body, in_reply_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      envelope.type,
      envelope.room,
      envelope.from,
      envelope.to,
      envelope.text,
      envelope.in_reply_to,
      envelope.ts
    );
  return getMessage(Number(info.lastInsertRowid));
}

export function replyMessage({ from, inReplyTo, text, room = null }) {
  const parent = getMessage(Number(inReplyTo));
  if (!parent) throw new Error(`No message with id ${inReplyTo}`);
  const to = parent.from;
  return postMessage({
    from,
    to,
    room: room || parent.room,
    text,
    type: "reply",
    inReplyTo: parent.id,
  });
}

export function getMessage(id) {
  const row = getDb()
    .prepare(`SELECT * FROM messages WHERE id = ?`)
    .get(Number(id));
  return row ? mapMessage(row) : null;
}

/**
 * Unread for an agent: DMs to them or room broadcasts, excluding their own,
 * without a receipt yet.
 */
export function checkInbox(agentId, { limit = 20, room = null } = {}) {
  const id = sanitizeId(agentId);
  registerAgent({ id, status: "waiting" });
  const params = [id, id, id];
  let sql = `
    SELECT m.* FROM messages m
    LEFT JOIN receipts r ON r.message_id = m.id AND r.agent_id = ?
    WHERE r.message_id IS NULL
      AND m.sender != ?
      AND (m.recipient = ? OR m.recipient IS NULL)
  `;
  if (room) {
    sql += ` AND m.room = ?`;
    params.push(room);
  }
  sql += ` ORDER BY m.id ASC LIMIT ?`;
  params.push(Math.min(Math.max(Number(limit) || 20, 1), 100));
  const rows = getDb().prepare(sql).all(...params);
  return rows.map(mapMessage);
}

export async function checkInboxWait(
  agentId,
  { limit = 20, room = null, waitMs = 0 } = {}
) {
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  let items = checkInbox(agentId, { limit, room });
  while (!items.length && Date.now() < deadline) {
    await sleep(Math.min(250, deadline - Date.now()));
    items = checkInbox(agentId, { limit, room });
  }
  return items;
}

export function readMessage(agentId, messageId) {
  const msg = getMessage(Number(messageId));
  if (!msg) throw new Error(`No message with id ${messageId}`);
  const id = sanitizeId(agentId);
  getDb()
    .prepare(
      `INSERT INTO receipts (agent_id, message_id, read_at)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id, message_id) DO UPDATE SET read_at = excluded.read_at`
    )
    .run(id, msg.id, utcNowIso());
  registerAgent({ id, status: "working" });
  return msg;
}

export function markAllRead(agentId, messageIds) {
  return messageIds.map((mid) => readMessage(agentId, mid));
}

function mapAgent(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    lastSeen: row.last_seen,
    meta: safeJson(row.meta_json),
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    type: row.type,
    room: row.room,
    from: row.sender,
    to: row.recipient,
    text: row.body,
    inReplyTo: row.in_reply_to,
    ts: row.created_at,
  };
}

function safeJson(s) {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
