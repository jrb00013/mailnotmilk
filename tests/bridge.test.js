import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, useDb, closeStore } from "../src/store.js";
import { openBridge } from "../src/bridge.js";

describe("bridge", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mnm-bridge-"));
    useDb(openStore(join(dir, "t.db")));
  });
  afterEach(() => {
    closeStore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("opens deepseek→claude paste bridge", () => {
    const r = openBridge({
      title: "Auth",
      from: "deepseek",
      peer: "claude",
      firstMessage: "look at auth.js",
    });
    assert.equal(r.goal, "deepseek ↔ claude");
    assert.match(r.pasteForPeer, /join_chat/);
    assert.match(r.pasteForPeer, /Claude Code/);
    assert.match(r.pasteForPeer, new RegExp(r.chat.id));
    assert.equal(r.kickoff.from, "deepseek");
    assert.match(r.instructionsForHuman, /paste/i);
  });
});
