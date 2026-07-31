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
      thread_root INTEGER,
      priority TEXT DEFAULT 'normal',
      tags_json TEXT DEFAULT '[]',
      attachments_json TEXT DEFAULT '[]',
      meta_json TEXT DEFAULT '{}',
      archived INTEGER DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS reactions (
      message_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (message_id, agent_id, emoji),
      FOREIGN KEY (message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS room_subs (
      agent_id TEXT NOT NULL,
      room TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, room)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient);
    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_root);
    CREATE INDEX IF NOT EXISTS idx_messages_archived ON messages(archived);
  `);
  migrate(db);
  return db;
}

function migrate(db) {
  const cols = db
    .prepare(`PRAGMA table_info(messages)`)
    .all()
    .map((c) => c.name);
  const add = (name, ddl) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE messages ADD COLUMN ${ddl}`);
  };
  add("thread_root", "thread_root INTEGER");
  add("priority", "priority TEXT DEFAULT 'normal'");
  add("tags_json", "tags_json TEXT DEFAULT '[]'");
  add("attachments_json", "attachments_json TEXT DEFAULT '[]'");
  add("meta_json", "meta_json TEXT DEFAULT '{}'");
  add("archived", "archived INTEGER DEFAULT 0");
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
  getDb()
    .prepare(
      `INSERT INTO agents (id, display_name, role, status, last_seen, meta_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, agents.display_name),
         role = COALESCE(excluded.role, agents.role),
         status = excluded.status,
         last_seen = excluded.last_seen,
         meta_json = excluded.meta_json`
    )
    .run(
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
  return getDb()
    .prepare(`SELECT * FROM agents WHERE last_seen >= ? ORDER BY last_seen DESC`)
    .all(cutoff)
    .map(mapAgent);
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
  return agent
    ? { id: agent.id, status: agent.status, lastSeen: agent.lastSeen }
    : null;
}

function extractMentions(text) {
  const found = new Set();
  const re = /@([a-zA-Z0-9_-]+)/g;
  let m;
  while ((m = re.exec(String(text))) !== null) found.add(sanitizeId(m[1]));
  return [...found];
}

export function postMessage({
  from,
  to = null,
  room = "general",
  text,
  type = "message",
  inReplyTo = null,
  priority = "normal",
  tags = [],
  attachments = [],
  meta = {},
}) {
  const envelope = makeEnvelope({
    type,
    from: sanitizeId(from),
    to: to ? sanitizeId(to) : null,
    room: room || "general",
    text,
    inReplyTo,
  });
  registerAgent({ id: envelope.from, status: "working" });

  let threadRoot = null;
  if (envelope.in_reply_to) {
    const parent = getMessage(envelope.in_reply_to);
    if (!parent) throw new Error(`No message with id ${envelope.in_reply_to}`);
    threadRoot = parent.threadRoot || parent.id;
  }

  const mentions = extractMentions(envelope.text);
  const mergedMeta = { ...meta, mentions };
  const pri = ["low", "normal", "high", "urgent"].includes(priority)
    ? priority
    : "normal";

  const info = getDb()
    .prepare(
      `INSERT INTO messages
        (type, room, sender, recipient, body, in_reply_to, thread_root, priority,
         tags_json, attachments_json, meta_json, archived, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    )
    .run(
      envelope.type,
      envelope.room,
      envelope.from,
      envelope.to,
      envelope.text,
      envelope.in_reply_to,
      threadRoot,
      pri,
      JSON.stringify(tags || []),
      JSON.stringify(attachments || []),
      JSON.stringify(mergedMeta),
      envelope.ts
    );

  const id = Number(info.lastInsertRowid);
  if (!threadRoot) {
    getDb().prepare(`UPDATE messages SET thread_root = ? WHERE id = ?`).run(id, id);
  }
  return getMessage(id);
}

export function replyMessage({
  from,
  inReplyTo,
  text,
  room = null,
  priority = "normal",
  tags = [],
  attachments = [],
  meta = {},
}) {
  const parent = getMessage(Number(inReplyTo));
  if (!parent) throw new Error(`No message with id ${inReplyTo}`);
  return postMessage({
    from,
    to: parent.from,
    room: room || parent.room,
    text,
    type: "reply",
    inReplyTo: parent.id,
    priority,
    tags,
    attachments,
    meta,
  });
}

/** Structured handoff — task packet agents can act on. */
export function postHandoff({
  from,
  to,
  title,
  objective,
  context = "",
  acceptance = [],
  files = [],
  room = "general",
  priority = "high",
}) {
  if (!to) throw new Error("handoff requires to");
  if (!title || !objective) throw new Error("handoff requires title and objective");
  const body = [
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

  return postMessage({
    from,
    to: sanitizeId(to),
    room,
    text: body,
    type: "handoff",
    priority,
    tags: ["handoff"],
    attachments: (files || []).map((path) => ({ type: "path", path })),
    meta: {
      handoff: {
        title,
        objective,
        acceptance: acceptance || [],
        files: files || [],
      },
    },
  });
}

export function getMessage(id) {
  const row = getDb()
    .prepare(`SELECT * FROM messages WHERE id = ?`)
    .get(Number(id));
  return row ? mapMessage(row) : null;
}

export function checkInbox(
  agentId,
  { limit = 20, room = null, includeArchived = false, priority = null } = {}
) {
  const id = sanitizeId(agentId);
  registerAgent({ id, status: "waiting" });
  const params = [id, id, id, id];
  let sql = `
    SELECT m.* FROM messages m
    LEFT JOIN receipts r ON r.message_id = m.id AND r.agent_id = ?
    WHERE r.message_id IS NULL
      AND m.sender != ?
      AND (
        m.recipient = ?
        OR m.recipient IS NULL
        OR instr(m.body, '@' || ?) > 0
      )
  `;
  if (!includeArchived) sql += ` AND m.archived = 0`;
  if (room) {
    sql += ` AND m.room = ?`;
    params.push(room);
  }
  if (priority) {
    sql += ` AND m.priority = ?`;
    params.push(priority);
  }
  sql += ` ORDER BY
    CASE m.priority
      WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    m.id ASC
    LIMIT ?`;
  params.push(Math.min(Math.max(Number(limit) || 20, 1), 100));
  return getDb()
    .prepare(sql)
    .all(...params)
    .map(mapMessage);
}

export async function checkInboxWait(
  agentId,
  { limit = 20, room = null, waitMs = 0, priority = null } = {}
) {
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  let items = checkInbox(agentId, { limit, room, priority });
  while (!items.length && Date.now() < deadline) {
    await sleep(Math.min(250, deadline - Date.now()));
    items = checkInbox(agentId, { limit, room, priority });
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

export function markUnread(agentId, messageId) {
  getDb()
    .prepare(`DELETE FROM receipts WHERE agent_id = ? AND message_id = ?`)
    .run(sanitizeId(agentId), Number(messageId));
  return getMessage(Number(messageId));
}

export function markAllRead(agentId, messageIds) {
  return messageIds.map((mid) => readMessage(agentId, mid));
}

export function getThread(messageId, { limit = 100 } = {}) {
  const msg = getMessage(Number(messageId));
  if (!msg) throw new Error(`No message with id ${messageId}`);
  const root = msg.threadRoot || msg.id;
  return getDb()
    .prepare(
      `SELECT * FROM messages WHERE thread_root = ? OR id = ?
       ORDER BY id ASC LIMIT ?`
    )
    .all(root, root, Math.min(Number(limit) || 100, 500))
    .map(mapMessage);
}

export function searchMessages({
  query,
  room = null,
  from = null,
  to = null,
  limit = 50,
  includeArchived = false,
} = {}) {
  if (!query || !String(query).trim()) throw new Error("search requires query");
  const params = [`%${String(query).trim()}%`];
  let sql = `SELECT * FROM messages WHERE body LIKE ?`;
  if (!includeArchived) sql += ` AND archived = 0`;
  if (room) {
    sql += ` AND room = ?`;
    params.push(room);
  }
  if (from) {
    sql += ` AND sender = ?`;
    params.push(sanitizeId(from));
  }
  if (to) {
    sql += ` AND recipient = ?`;
    params.push(sanitizeId(to));
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  return getDb()
    .prepare(sql)
    .all(...params)
    .map(mapMessage);
}

export function listHistory({
  agentId = null,
  room = null,
  limit = 50,
  includeArchived = false,
} = {}) {
  const params = [];
  let sql = `SELECT * FROM messages WHERE 1=1`;
  if (!includeArchived) sql += ` AND archived = 0`;
  if (room) {
    sql += ` AND room = ?`;
    params.push(room);
  }
  if (agentId) {
    const id = sanitizeId(agentId);
    sql += ` AND (sender = ? OR recipient = ? OR recipient IS NULL)`;
    params.push(id, id);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  return getDb()
    .prepare(sql)
    .all(...params)
    .map(mapMessage);
}

export function archiveMessage(messageId) {
  getDb()
    .prepare(`UPDATE messages SET archived = 1 WHERE id = ?`)
    .run(Number(messageId));
  return getMessage(Number(messageId));
}

export function unarchiveMessage(messageId) {
  getDb()
    .prepare(`UPDATE messages SET archived = 0 WHERE id = ?`)
    .run(Number(messageId));
  return getMessage(Number(messageId));
}

export function react(messageId, agentId, emoji) {
  if (!emoji) throw new Error("react requires emoji");
  const msg = getMessage(Number(messageId));
  if (!msg) throw new Error(`No message with id ${messageId}`);
  getDb()
    .prepare(
      `INSERT INTO reactions (message_id, agent_id, emoji, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id, agent_id, emoji) DO NOTHING`
    )
    .run(msg.id, sanitizeId(agentId), String(emoji).slice(0, 32), utcNowIso());
  return listReactions(msg.id);
}

export function listReactions(messageId) {
  return getDb()
    .prepare(
      `SELECT emoji, agent_id, created_at FROM reactions WHERE message_id = ? ORDER BY created_at`
    )
    .all(Number(messageId))
    .map((r) => ({
      emoji: r.emoji,
      agentId: r.agent_id,
      ts: r.created_at,
    }));
}

export function subscribeRoom(agentId, room) {
  getDb()
    .prepare(
      `INSERT INTO room_subs (agent_id, room, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id, room) DO NOTHING`
    )
    .run(sanitizeId(agentId), room || "general", utcNowIso());
  return listSubscriptions(agentId);
}

export function unsubscribeRoom(agentId, room) {
  getDb()
    .prepare(`DELETE FROM room_subs WHERE agent_id = ? AND room = ?`)
    .run(sanitizeId(agentId), room || "general");
  return listSubscriptions(agentId);
}

export function listSubscriptions(agentId) {
  return getDb()
    .prepare(`SELECT room, created_at FROM room_subs WHERE agent_id = ? ORDER BY room`)
    .all(sanitizeId(agentId))
    .map((r) => ({ room: r.room, ts: r.created_at }));
}

export function listRooms() {
  return getDb()
    .prepare(
      `SELECT room, COUNT(*) AS message_count, MAX(created_at) AS last_activity
       FROM messages WHERE archived = 0
       GROUP BY room ORDER BY last_activity DESC`
    )
    .all()
    .map((r) => ({
      room: r.room,
      messageCount: r.message_count,
      lastActivity: r.last_activity,
    }));
}

export function stats() {
  const db = getDb();
  const messages = db.prepare(`SELECT COUNT(*) AS c FROM messages`).get().c;
  const unreadish = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages m
       WHERE m.archived = 0 AND NOT EXISTS (
         SELECT 1 FROM receipts r WHERE r.message_id = m.id
       )`
    )
    .get().c;
  const agents = db.prepare(`SELECT COUNT(*) AS c FROM agents`).get().c;
  const rooms = db
    .prepare(`SELECT COUNT(DISTINCT room) AS c FROM messages`)
    .get().c;
  const byPriority = db
    .prepare(
      `SELECT priority, COUNT(*) AS c FROM messages WHERE archived = 0 GROUP BY priority`
    )
    .all()
    .map((r) => ({ priority: r.priority, count: r.c }));
  const byType = db
    .prepare(`SELECT type, COUNT(*) AS c FROM messages GROUP BY type`)
    .all()
    .map((r) => ({ type: r.type, count: r.c }));
  return {
    messages,
    neverAcked: unreadish,
    agents,
    rooms,
    byPriority,
    byType,
    agentsLive: listAgents({ sinceMinutes: 60 }),
  };
}

export function board() {
  const agents = listAgents({ sinceMinutes: 60 * 24 });
  const rooms = listRooms();
  const recent = listHistory({ limit: 15 });
  const urgent = getDb()
    .prepare(
      `SELECT * FROM messages WHERE archived = 0 AND priority IN ('urgent','high')
       ORDER BY id DESC LIMIT 10`
    )
    .all()
    .map(mapMessage);
  return { agents, rooms, recent, urgent, stats: stats() };
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
    threadRoot: row.thread_root,
    priority: row.priority || "normal",
    tags: safeJson(row.tags_json, []),
    attachments: safeJson(row.attachments_json, []),
    meta: safeJson(row.meta_json, {}),
    archived: Boolean(row.archived),
    ts: row.created_at,
  };
}

function safeJson(s, fallback = {}) {
  try {
    return JSON.parse(s || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
