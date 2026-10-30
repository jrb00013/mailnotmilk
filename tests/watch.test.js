import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openStore,
  useDb,
  closeStore,
  postMessage,
  checkInbox,
} from "../src/store.js";
import { watchInbox } from "../src/watch.js";

function waitFor(predicate, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error("timed out waiting for condition"));
      }
    }, 10);
  });
}

describe("watchInbox", () => {
  let dir;
  let stop;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mnm-watch-"));
    useDb(openStore(join(dir, "t.db")));
  });

  afterEach(() => {
    if (stop) stop();
    stop = null;
    closeStore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("delivers every message even when there are more than one page", async () => {
    for (let i = 1; i <= 5; i++) {
      postMessage({ from: "cursor", to: "claude", text: `m${i}` });
    }
    const delivered = [];
    stop = watchInbox({
      agentId: "claude",
      limit: 2,
      intervalMs: 10,
      onMessage: (m) => delivered.push(m),
    });

    await waitFor(() => delivered.length >= 5);
    assert.deepEqual(
      delivered.map((m) => m.text).sort(),
      ["m1", "m2", "m3", "m4", "m5"]
    );
  });

  it("does not lose lower-priority messages behind a full page of urgent ones", async () => {
    for (let i = 1; i <= 3; i++) {
      postMessage({ from: "cursor", to: "claude", text: `low${i}`, priority: "low" });
    }
    for (let i = 1; i <= 2; i++) {
      postMessage({ from: "cursor", to: "claude", text: `urgent${i}`, priority: "urgent" });
    }
    const delivered = [];
    stop = watchInbox({
      agentId: "claude",
      limit: 2,
      intervalMs: 10,
      onMessage: (m) => delivered.push(m),
    });

    await waitFor(() => delivered.length >= 5);
    assert.deepEqual(
      delivered.map((m) => m.text).sort(),
      ["low1", "low2", "low3", "urgent1", "urgent2"]
    );
  });

  it("acks after collecting so paging does not skip rows", async () => {
    for (let i = 1; i <= 5; i++) {
      postMessage({ from: "cursor", to: "claude", text: `a${i}` });
    }
    const delivered = [];
    stop = watchInbox({
      agentId: "claude",
      limit: 2,
      intervalMs: 10,
      ack: true,
      onMessage: (m) => delivered.push(m),
    });

    await waitFor(() => delivered.length >= 5);
    assert.equal(delivered.length, 5);
    await waitFor(() => checkInbox("claude").length === 0);
  });

  it("delivers later messages once and does not reprint earlier ones", async () => {
    postMessage({ from: "cursor", to: "claude", text: "first" });
    const delivered = [];
    stop = watchInbox({
      agentId: "claude",
      limit: 2,
      intervalMs: 10,
      onMessage: (m) => delivered.push(m),
    });

    await waitFor(() => delivered.length === 1);
    postMessage({ from: "cursor", to: "claude", text: "second" });
    postMessage({ from: "cursor", to: "claude", text: "third" });
    await waitFor(() => delivered.length >= 3);

    assert.deepEqual(
      delivered.map((m) => m.text),
      ["first", "second", "third"]
    );
  });
});
