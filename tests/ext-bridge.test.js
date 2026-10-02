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

  it("drops a timed-out command from the queue", async () => {
    const before = extStatus().pendingCommands;
    // Nobody is polling /next, so this never gets delivered.
    await assert.rejects(
      () => extRequest("send", { text: "stale" }, { timeoutMs: 150 }),
      /did not respond/
    );
    // It must not be left behind: the extension long-polls this queue, so a
    // command nobody is waiting on would still fire against a real tab later.
    assert.equal(
      extStatus().pendingCommands,
      before,
      "timed-out command must not linger in the queue"
    );
    const next = await takeExtCommand({ timeoutMs: 300 });
    assert.equal(next, null, "stale command must not be delivered late");
  });
});
