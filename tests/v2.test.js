import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHandoffMarkdown, parseHandoffMeta } from "../src/handoff.js";
import { renderBoard } from "../src/board.js";

describe("handoff", () => {
  it("builds markdown", () => {
    const md = buildHandoffMarkdown({
      title: "T",
      objective: "O",
      files: ["a.js"],
      acceptance: ["ok"],
    });
    assert.match(md, /Handoff: T/);
    assert.match(md, /a\.js/);
  });

  it("parses meta", () => {
    assert.equal(parseHandoffMeta({ meta: { handoff: { title: "x" } } }).title, "x");
    assert.equal(parseHandoffMeta({}), null);
  });
});

describe("board", () => {
  it("renders empty-ish board", () => {
    const text = renderBoard({
      agents: [{ id: "cursor", status: "idle", lastSeen: "now" }],
      rooms: [{ room: "general", messageCount: 1, lastActivity: "now" }],
      urgent: [],
      recent: [],
      stats: { messages: 1, agents: 1, rooms: 1, neverAcked: 0 },
    });
    assert.match(text, /mailnotmilk board/);
    assert.match(text, /cursor/);
  });
});
