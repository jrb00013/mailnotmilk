import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extStatus,
  noteExtHello,
  takeExtCommand,
  extRequest,
  resolveExtResult,
} from "../src/ext-bridge.js";

describe("ext-bridge", () => {
  it("tracks hello", () => {
    noteExtHello({ tabCount: 2 });
    const st = extStatus();
    assert.equal(st.connected, true);
    assert.equal(st.lastHello.tabCount, 2);
  });

  it("round-trips a command", async () => {
    const pending = extRequest("ping", {}, { timeoutMs: 2000 });
    const cmd = await takeExtCommand({ timeoutMs: 1000 });
    assert.ok(cmd);
    assert.equal(cmd.type, "ping");
    resolveExtResult({ id: cmd.id, ok: true, data: { pong: true } });
    const data = await pending;
    assert.deepEqual(data, { pong: true });
  });
});
