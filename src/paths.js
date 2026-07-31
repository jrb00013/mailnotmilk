import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const HOME = homedir();

/** Stable data root under XDG or ~/.agent-mailbox — not /tmp. */
export function dataDir() {
  const fromEnv = process.env.MAILNOTMILK_DATA_DIR;
  if (fromEnv) return fromEnv;
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "mailnotmilk");
  return join(HOME, ".mailnotmilk");
}

export function ensureDataDir() {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath() {
  return join(ensureDataDir(), "mailbox.db");
}
