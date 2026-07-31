import { randomBytes } from "node:crypto";
import { utcNowIso } from "./envelope.js";
import { sanitizeId } from "./identity.js";
import { getDb, registerAgent, postMessage, listHistory } from "./store.js";
import { cliInvocation } from "./path-shim.js";

function shortId(bytes = 6) {
  return randomBytes(bytes).toString("base64url");
}

/** Ensure chats tables exist (idempotent). */
export function ensureChatSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      room TEXT NOT NULL,
      invite_token TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      meta_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, agent_id),
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );

    CREATE INDEX IF NOT EXISTS idx_chats_invite ON chats(invite_token);
    CREATE INDEX IF NOT EXISTS idx_chats_room ON chats(room);
  `);
}

export function createChat({
  title = "Untitled chat",
  createdBy,
  members = [],
  meta = {},
} = {}) {
  ensureChatSchema();
  const id = shortId(8);
  const invite = shortId(12);
  const room = `chat-${id}`;
  const creator = sanitizeId(createdBy);
  registerAgent({ id: creator, status: "working" });
  getDb()
    .prepare(
      `INSERT INTO chats (id, title, room, invite_token, created_by, created_at, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, title, room, invite, creator, utcNowIso(), JSON.stringify(meta || {}));

  joinChat({ chatId: id, agentId: creator, role: "owner" });
  for (const m of members) {
    if (sanitizeId(m) !== creator) joinChat({ chatId: id, agentId: m, role: "member" });
  }

  postMessage({
    from: creator,
    room,
    text: `Chat created: **${title}**\nInvite peers with the link from \`mailnotmilk chat link ${id}\`.`,
    type: "system",
    tags: ["chat", "system"],
    meta: { chat_id: id },
  });

  return getChat(id);
}

export function getChat(chatId) {
  ensureChatSchema();
  const row = getDb().prepare(`SELECT * FROM chats WHERE id = ?`).get(chatId);
  if (!row) return null;
  return mapChat(row);
}

export function getChatByInvite(token) {
  ensureChatSchema();
  const row = getDb()
    .prepare(`SELECT * FROM chats WHERE invite_token = ?`)
    .get(token);
  return row ? mapChat(row) : null;
}

export function getChatByRoom(room) {
  ensureChatSchema();
  const row = getDb().prepare(`SELECT * FROM chats WHERE room = ?`).get(room);
  return row ? mapChat(row) : null;
}

export function listChats({ limit = 50 } = {}) {
  ensureChatSchema();
  return getDb()
    .prepare(`SELECT * FROM chats ORDER BY created_at DESC LIMIT ?`)
    .all(Math.min(Number(limit) || 50, 200))
    .map(mapChat);
}

export function joinChat({ chatId, agentId, role = "member" } = {}) {
  ensureChatSchema();
  const chat = getChat(chatId);
  if (!chat) throw new Error(`Unknown chat ${chatId}`);
  const id = sanitizeId(agentId);
  registerAgent({ id, status: "waiting" });
  getDb()
    .prepare(
      `INSERT INTO chat_members (chat_id, agent_id, role, joined_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id, agent_id) DO UPDATE SET role = excluded.role`
    )
    .run(chat.id, id, role, utcNowIso());
  return { chat: getChat(chat.id), member: id, members: listMembers(chat.id) };
}

export function joinByInvite({ token, agentId } = {}) {
  const chat = getChatByInvite(token);
  if (!chat) throw new Error("Invalid or expired invite token");
  return joinChat({ chatId: chat.id, agentId, role: "member" });
}

export function listMembers(chatId) {
  ensureChatSchema();
  return getDb()
    .prepare(
      `SELECT agent_id, role, joined_at FROM chat_members WHERE chat_id = ? ORDER BY joined_at`
    )
    .all(chatId)
    .map((r) => ({
      agentId: r.agent_id,
      role: r.role,
      joinedAt: r.joined_at,
    }));
}

export function chatMessages(chatId, { limit = 100 } = {}) {
  const chat = getChat(chatId);
  if (!chat) throw new Error(`Unknown chat ${chatId}`);
  return listHistory({ room: chat.room, limit }).reverse();
}

export function postToChat({
  chatId,
  from,
  text,
  type = "message",
  priority = "normal",
  to = null,
} = {}) {
  const chat = getChat(chatId);
  if (!chat) throw new Error(`Unknown chat ${chatId}`);
  joinChat({ chatId: chat.id, agentId: from });
  return postMessage({
    from,
    to,
    room: chat.room,
    text,
    type,
    priority,
    tags: ["chat"],
    meta: { chat_id: chat.id },
  });
}

/**
 * Build shareable links + paste prompts.
 * Opening Claude does NOT auto-happen — the invite is what you paste.
 */
export function buildInviteBundle(chat, { hubBase, from = null, peer = null } = {}) {
  const base =
    hubBase ||
    process.env.MAILNOTMILK_HUB_URL ||
    `http://127.0.0.1:${process.env.MAILNOTMILK_HUB_PORT || 7879}`;
  const joinUrl = `${base.replace(/\/$/, "")}/c/${chat.id}?invite=${chat.inviteToken}`;
  const deep = `mailnotmilk://join/${chat.inviteToken}`;

  // Absolute local CLI — works even when `mailnotmilk` is not on PATH
  const cli = cliInvocation();

  const generic = [
    `Join this mailnotmilk chat and collaborate with me.`,
    ``,
    `Chat: ${chat.title} (${chat.id})`,
    `Link: ${joinUrl}`,
    ``,
    `If you have mailnotmilk MCP: call join_chat with invite_token "${chat.inviteToken}", then chat_history / chat_say on chat_id "${chat.id}".`,
    `CLI: ${cli} chat join ${chat.inviteToken}`,
    `Then: ${cli} chat say ${chat.id} -t "your reply"`,
  ].join("\n");

  let claudePrompt = generic;
  let cursorPrompt = generic;
  let peerPrompt = generic;

  // The joining agent must use the id the chat actually expects. Hardcoding
  // "claude" meant a chat created for e.g. "claude-cutover" produced a prompt
  // that joined under the wrong id, and whoever was watching for the real peer
  // never saw a single message.
  const memberIds = (chat.members || [])
    .map((m) => (typeof m === "string" ? m : m?.agentId))
    .filter(Boolean);
  const peerId =
    peer ||
    memberIds.find((id) => id !== chat.createdBy && id !== "human") ||
    "claude";
  const isClaudePeer = /^claude(-|$)/i.test(peerId);

  if (isClaudePeer) {
    const fromId = from || chat.createdBy || "deepseek";
    const agentId = peerId === "claude-code" ? "claude" : peerId;
    claudePrompt = [
      `You are Claude Code. Join a live collaboration chat with ${fromId}.`,
      ``,
      `Do this now:`,
      `1. join_chat invite_token="${chat.inviteToken}" agent_id="${agentId}"`,
      `2. chat_history chat_id="${chat.id}"`,
      `3. Reply with chat_say chat_id="${chat.id}"`,
      `4. Keep using this chat (check_inbox / chat_history) while collaborating`,
      ``,
      `Title: ${chat.title}`,
      `Hub: ${joinUrl}`,
      ``,
      `CLI fallback:`,
      `  ${cli} chat join ${chat.inviteToken} --agent ${agentId}`,
      `  ${cli} chat say ${chat.id} -t "hello" --from ${agentId}`,
    ].join("\n");
    peerPrompt = claudePrompt;
  }

  // Single-line form for typing into a live terminal: no blank lines, since a
  // newline submits and would fire the prompt half-written.
  const bootstrapPrompt =
    `You are now bridged to a browser AI over mailnotmilk. ` +
    `Join chat ${chat.id} as agent id "${peerId}" and keep the conversation going. ` +
    `If you have the mailnotmilk MCP tools, use them: ` +
    `join_chat(invite_token="${chat.inviteToken}", agent_id="${peerId}") to join, ` +
    `chat_history(chat_id="${chat.id}") to read what has been said, ` +
    `chat_say(chat_id="${chat.id}", text="...") to reply, ` +
    `and check_inbox() to see new messages. ` +
    `Poll chat_history or check_inbox periodically and answer anything addressed to you. ` +
    `If those tools are not listed, the MCP server is not loaded in this session — ` +
    `use the CLI instead: ${cli} chat join ${chat.inviteToken} --agent ${peerId} ` +
    `then ${cli} chat say ${chat.id} -t "your reply" --from ${peerId} ` +
    `and ${cli} chat log ${chat.id} to read. ` +
    `Messages tagged "## From browser (...) assistant" are the browser AI talking to you; ` +
    `ignore "## Relayed to browser" system lines and any "## From browser (...) user" echo of your own text. ` +
    `Start by reading the history, then send one short message introducing what you are working on.`;

  return {
    chatId: chat.id,
    title: chat.title,
    room: chat.room,
    inviteToken: chat.inviteToken,
    peerId,
    joinUrl,
    deepLink: deep,
    peerPrompt,
    cursorPrompt,
    claudePrompt,
    bootstrapPrompt,
    note:
      "This does not pop open Claude/Cursor. Paste peerPrompt / claudePrompt into the other agent.",
  };
}

export function rotateInvite(chatId) {
  ensureChatSchema();
  const chat = getChat(chatId);
  if (!chat) throw new Error(`Unknown chat ${chatId}`);
  const invite = shortId(12);
  getDb()
    .prepare(`UPDATE chats SET invite_token = ? WHERE id = ?`)
    .run(invite, chatId);
  return buildInviteBundle(getChat(chatId));
}

function mapChat(row) {
  let meta = {};
  try {
    meta = JSON.parse(row.meta_json || "{}");
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    title: row.title,
    room: row.room,
    inviteToken: row.invite_token,
    createdBy: row.created_by,
    createdAt: row.created_at,
    meta,
    members: listMembers(row.id),
  };
}

export function resolveChatRef(ref) {
  if (!ref) return null;
  if (ref.startsWith("chat-")) return getChatByRoom(ref);
  const byId = getChat(ref);
  if (byId) return byId;
  return getChatByInvite(ref);
}
