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
  postHandoff,
  getThread,
  searchMessages,
  archiveMessage,
  react,
  markUnread,
  stats,
  board,
  listRooms,
} from "../src/store.js";

describe("store", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mailnotmilk-"));
    useDb(openStore(join(dir, "t.db")));
  });

  afterEach(() => {
    closeStore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers agents", () => {
    const a = registerAgent({
      id: "cursor",
      displayName: "Cursor",
      role: "orchestrator",
    });
    assert.equal(a.id, "cursor");
    assert.equal(listAgents().length, 1);
  });

  it("DM round-trip with ack", () => {
    postMessage({ from: "cursor", to: "claude", text: "review auth" });
    const inbox = checkInbox("claude");
    assert.equal(inbox.length, 1);
    readMessage("claude", inbox[0].id);
    assert.equal(checkInbox("claude").length, 0);
  });

  it("does not show own messages in inbox", () => {
    postMessage({ from: "cursor", to: "claude", text: "secret" });
    assert.equal(checkInbox("cursor").length, 0);
  });

  it("broadcasts to room", () => {
    postMessage({ from: "cursor", text: "standup", room: "ops" });
    assert.equal(checkInbox("claude", { room: "ops" }).length, 1);
  });

  it("replies and threads", () => {
    const m = postMessage({ from: "cursor", to: "claude", text: "q?" });
    const r = replyMessage({ from: "claude", inReplyTo: m.id, text: "a." });
    assert.equal(r.to, "cursor");
    const thread = getThread(m.id);
    assert.equal(thread.length, 2);
    assert.equal(thread[0].threadRoot, m.id);
    assert.equal(thread[1].threadRoot, m.id);
  });

  it("sets status", () => {
    setStatus("cursor", "working");
    assert.equal(getStatus("cursor").status, "working");
  });

  it("delivers @mentions across rooms", () => {
    postMessage({
      from: "cursor",
      text: "hey @claude look at this",
      room: "noise",
    });
    const inbox = checkInbox("claude");
    assert.equal(inbox.length, 1);
  });

  it("priority sorts urgent first", () => {
    postMessage({ from: "a", to: "b", text: "later", priority: "low" });
    postMessage({ from: "a", to: "b", text: "now", priority: "urgent" });
    const inbox = checkInbox("b");
    assert.equal(inbox[0].text, "now");
  });

  it("postHandoff packs meta", () => {
    const h = postHandoff({
      from: "cursor",
      to: "claude",
      title: "Auth review",
      objective: "Review auth.js",
      files: ["src/auth.js"],
      acceptance: ["no secrets logged"],
    });
    assert.equal(h.type, "handoff");
    assert.equal(h.meta.handoff.title, "Auth review");
    assert.equal(h.attachments[0].path, "src/auth.js");
  });

  it("search archive react unread", () => {
    const m = postMessage({ from: "cursor", to: "claude", text: "needle xyz" });
    assert.equal(searchMessages({ query: "needle" }).length, 1);
    react(m.id, "claude", "👍");
    readMessage("claude", m.id);
    markUnread("claude", m.id);
    assert.equal(checkInbox("claude").length, 1);
    archiveMessage(m.id);
    assert.equal(checkInbox("claude").length, 0);
  });

  it("stats board rooms", () => {
    postMessage({ from: "cursor", text: "hi", room: "general" });
    assert.ok(stats().messages >= 1);
    assert.ok(board().recent.length >= 1);
    assert.ok(listRooms().some((r) => r.room === "general"));
  });
});
