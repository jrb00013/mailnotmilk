import { DatabaseSync } from "node:sqlite";
import { dbPath, ensureDataDir } from "./paths.js";

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
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      agent_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient);
    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room);
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
