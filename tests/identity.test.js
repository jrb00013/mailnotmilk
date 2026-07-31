import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeId, detectProvider } from "../src/identity.js";

describe("sanitizeId", () => {
  it("strips unsafe characters", () => {
    assert.equal(sanitizeId("claude code!"), "claude_code_");
  });

  it("handles empty", () => {
    assert.equal(sanitizeId(""), "unknown");
  });
});

describe("detectProvider", () => {
  it("respects MAILNOTMILK_AGENT_ID", () => {
    const prev = process.env.MAILNOTMILK_AGENT_ID;
    process.env.MAILNOTMILK_AGENT_ID = "my-agent";
    try {
      assert.equal(detectProvider(), "my-agent");
    } finally {
      if (prev === undefined) delete process.env.MAILNOTMILK_AGENT_ID;
      else process.env.MAILNOTMILK_AGENT_ID = prev;
    }
  });
});
