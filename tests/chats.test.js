import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, useDb, closeStore } from "../src/store.js";
import {
  createChat,
  joinByInvite,
  postToChat,
  chatMessages,
  buildInviteBundle,
  listChats,
} from "../src/chats.js";
import { createHubServer } from "../src/hub.js";

describe("chats", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mnm-chat-"));
    useDb(openStore(join(dir, "t.db")));
  });

  afterEach(() => {
    closeStore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates chat with invite bundle", () => {
    const chat = createChat({ title: "Review auth", createdBy: "cursor" });
    assert.ok(chat.id);
    assert.ok(chat.inviteToken);
    assert.match(chat.room, /^chat-/);
    const invite = buildInviteBundle(chat);
    assert.match(invite.joinUrl, /\/c\//);
    assert.match(invite.peerPrompt, /join_chat/);
    assert.match(invite.note, /does not pop/);
  });

  it("join by invite and talk", () => {
    const chat = createChat({ title: "Pair", createdBy: "cursor" });
    joinByInvite({ token: chat.inviteToken, agentId: "claude" });
    postToChat({ chatId: chat.id, from: "claude", text: "here" });
    const log = chatMessages(chat.id);
    assert.ok(log.some((m) => m.text === "here"));
    assert.ok(listChats().length >= 1);
  });
});

describe("hub", () => {
  let dir;
  let hub;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "mnm-hub-"));
    process.env.MAILNOTMILK_DATA_DIR = dir;
    useDb(openStore(join(dir, "t.db")));
    hub = createHubServer({ port: 0 });
    await new Promise((resolve) => {
      hub.server.listen(0, "127.0.0.1", resolve);
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => hub.server.close(resolve));
    closeStore();
    delete process.env.MAILNOTMILK_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves create + chat page", async () => {
    const { port } = hub.server.address();
    const created = await fetch(`http://127.0.0.1:${port}/api/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "API chat", createdBy: "cursor" }),
    }).then((r) => r.json());
    assert.ok(created.chat.id);
    assert.ok(created.joinUrl);

    const page = await fetch(
      `http://127.0.0.1:${port}/c/${created.chat.id}?invite=${created.inviteToken}`
    );
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Paste this into the other agent/);
    assert.match(html, /API chat/);
  });
});

describe("invite peer id", () => {
  it("uses the chat's real peer id, not a hardcoded 'claude'", () => {
    const chat = createChat({
      title: "Browser chatgpt ↔ claude-cutover",
      createdBy: "web-ai",
      members: ["claude-cutover"],
    });
    const inv = buildInviteBundle(chat, { from: "web-ai", peer: "claude-cutover" });
    assert.match(inv.claudePrompt, /agent_id="claude-cutover"/);
    assert.match(inv.claudePrompt, /--agent claude-cutover/);
    assert.match(inv.claudePrompt, /--from claude-cutover/);
    assert.ok(!/agent_id="claude"/.test(inv.claudePrompt), "must not join as bare claude");
  });

  it("infers the peer from chat members when not passed explicitly", () => {
    const chat = createChat({
      title: "t",
      createdBy: "web-ai",
      members: ["claude-alpha"],
    });
    const inv = buildInviteBundle(chat);
    assert.match(inv.claudePrompt, /agent_id="claude-alpha"/);
  });

  it("still emits a Claude prompt for the plain 'claude' peer", () => {
    const chat = createChat({ title: "t", createdBy: "web-ai", members: ["claude"] });
    const inv = buildInviteBundle(chat, { peer: "claude" });
    assert.match(inv.claudePrompt, /agent_id="claude"/);
  });

  it("maps claude-code to the claude agent id", () => {
    const chat = createChat({ title: "t", createdBy: "web-ai", members: ["claude-code"] });
    const inv = buildInviteBundle(chat, { peer: "claude-code" });
    assert.match(inv.claudePrompt, /agent_id="claude"/);
  });

  it("leaves a non-claude peer on the generic prompt", () => {
    const chat = createChat({ title: "t", createdBy: "web-ai", members: ["cursor"] });
    const inv = buildInviteBundle(chat, { peer: "cursor" });
    assert.ok(!/You are Claude Code/.test(inv.claudePrompt));
  });
});
