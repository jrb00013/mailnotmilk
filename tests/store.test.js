import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openStore,
  useDb,
  closeStore,
  registerAgent,
  postMessage,
  checkInbox,
  readMessage,
  replyMessage,
  listAgents,
  setStatus,
  getStatus,
} from "../src/store.js";

describe("store", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mailnotmilk-"));
    const db = openStore(join(dir, "t.db"));
    useDb(db);
  });

  afterEach(() => {
    closeStore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers agents", () => {
    const a = registerAgent({ id: "cursor", displayName: "Cursor", role: "orchestrator" });
    assert.equal(a.id, "cursor");
    assert.equal(a.displayName, "Cursor");
    const listed = listAgents();
    assert.equal(listed.length, 1);
  });

  it("DM round-trip with ack", () => {
    postMessage({ from: "cursor", to: "claude", text: "review auth" });
    const inbox = checkInbox("claude");
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].text, "review auth");
    readMessage("claude", inbox[0].id);
    assert.equal(checkInbox("claude").length, 0);
  });

  it("does not show own messages in inbox", () => {
    postMessage({ from: "cursor", to: "claude", text: "secret" });
    assert.equal(checkInbox("cursor").length, 0);
  });

  it("broadcasts to room", () => {
    postMessage({ from: "cursor", text: "standup", room: "ops" });
    const inbox = checkInbox("claude", { room: "ops" });
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].to, null);
  });

  it("replies to sender", () => {
    const m = postMessage({ from: "cursor", to: "claude", text: "q?" });
    const r = replyMessage({ from: "claude", inReplyTo: m.id, text: "a." });
    assert.equal(r.type, "reply");
    assert.equal(r.to, "cursor");
    assert.equal(r.inReplyTo, m.id);
    const forCursor = checkInbox("cursor");
    assert.equal(forCursor.length, 1);
    assert.equal(forCursor[0].text, "a.");
  });

  it("sets status", () => {
    setStatus("cursor", "working");
    assert.equal(getStatus("cursor").status, "working");
  });
});
