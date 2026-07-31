import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeEnvelope, summarizeEnvelope } from "../src/envelope.js";

describe("makeEnvelope", () => {
  it("builds a DM", () => {
    const e = makeEnvelope({
      from: "cursor",
      to: "claude",
      text: "hello",
    });
    assert.equal(e.from, "cursor");
    assert.equal(e.to, "claude");
    assert.equal(e.room, "general");
    assert.equal(e.type, "message");
    assert.ok(e.ts);
  });

  it("broadcast when to omitted", () => {
    const e = makeEnvelope({ from: "cursor", text: "hi room" });
    assert.equal(e.to, null);
  });

  it("rejects empty text", () => {
    assert.throws(() => makeEnvelope({ from: "a", text: "" }));
  });
});

describe("summarizeEnvelope", () => {
  it("includes from and preview", () => {
    const s = summarizeEnvelope({
      id: 1,
      from: "cursor",
      to: "claude",
      room: "general",
      text: "please review",
    });
    assert.match(s, /cursor/);
    assert.match(s, /claude/);
    assert.match(s, /please review/);
  });
});
