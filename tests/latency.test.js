import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { latency, fastMode } from "../src/latency.js";

describe("latency knobs", () => {
  it("defaults to fast mode", () => {
    delete process.env.MAILNOTMILK_FAST;
    assert.equal(fastMode(), true);
    const L = latency();
    assert.ok(L.postSendMs < 500);
    assert.ok(L.cfPollMs <= 500);
    assert.ok(L.assistantPollMs <= 300);
    assert.equal(L.reuseCdpSession, true);
  });

  it("honors MAILNOTMILK_FAST=0 for legacy waits", () => {
    process.env.MAILNOTMILK_FAST = "0";
    try {
      assert.equal(fastMode(), false);
      const L = latency();
      assert.ok(L.postSendMs >= 1000);
      assert.ok(L.cfPollMs >= 1000);
    } finally {
      delete process.env.MAILNOTMILK_FAST;
    }
  });
});
