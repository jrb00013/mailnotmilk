import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The bug this guards against: the extension's command queue lives in
 * ext-bridge.js, and only the hub process ever touches it. Every other process
 * (relay, run-stack, the MCP server) used to import that module directly, read
 * its own empty copy, and concluded "no extension installed" — then launched a
 * second browser and timed out on every command.
 *
 * These tests spawn a REAL hub in a child process and talk to it over HTTP,
 * because the failure mode was specifically cross-process. An in-process test
 * passes even with the bug present, so it proves nothing.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "mailnotmilk.js");

// A real hub must own a real socket, but not a fixed one: a leftover hub (or a
// developer's own `mailnotmilk hub`) on a hardcoded port makes the child fail
// to bind while these tests still pass against the *old* process, which is
// exactly the cross-process confusion this file exists to catch.
const PORT = 20000 + Math.floor(Math.random() * 20000);
const HUB = `http://127.0.0.1:${PORT}`;

function postJson(path, body) {
  return fetch(`${HUB}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

function getJson(path) {
  return fetch(`${HUB}${path}`).then((r) => r.json());
}

async function waitForHub(child, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // If the child died (e.g. EADDRINUSE), stop waiting — otherwise we would
    // happily test some *other* process that happens to own the port.
    if (child.exitCode !== null) {
      throw new Error(`hub child exited with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${HUB}/api/ext/status`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("hub did not start");
}

/**
 * Stand in for the Chrome extension: long-poll /next, then answer.
 *
 * Exactly one of these may run at a time — several would race for the same
 * command, which is a test artefact, not real behaviour (only one Chrome
 * extension exists). `currentHandler` is swapped per test.
 */
let currentHandler = async () => ({ ok: true });
let stopExtension = false;

async function startFakeExtension() {
  while (!stopExtension) {
    let cmd = null;
    try {
      const body = await fetch(`${HUB}/api/ext/next?timeoutMs=1000`).then((r) =>
        r.json()
      );
      cmd = body?.command || null;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    if (!cmd) continue;
    let data = null;
    let error = null;
    try {
      data = await currentHandler(cmd);
    } catch (err) {
      error = err.message;
    }
    await postJson("/api/ext/result", {
      id: cmd.id,
      ok: !error,
      data,
      error,
    });
  }
}

describe("ext-client across processes", () => {
  let hub;

  before(async () => {
    process.env.MAILNOTMILK_HUB_PORT = String(PORT);
    hub = spawn(process.execPath, [CLI, "hub", "-p", String(PORT)], {
      cwd: ROOT,
      stdio: "ignore",
      env: process.env,
    });
    await waitForHub(hub);
    // Started after the hub so the first hello/status tests are not racing it.
    startFakeExtension();
  });

  after(() => {
    stopExtension = true;
    if (hub && !hub.killed) hub.kill();
  });

  it("sees an extension hello that a different process sent", async () => {
    // Precondition: the hub knows about an extension...
    const hello = await postJson("/api/ext/hello", {
      name: "fake",
      version: "1.0",
      tabCount: 2,
    });
    assert.equal(hello.connected, true);

    // ...and so must a client in THIS process, which never saw the hello.
    const ext = await import("../src/ext-client.js");
    const st = await ext.extStatus();
    assert.equal(st.connected, true, "client must read hub state, not local state");
    assert.equal(st.lastHello.tabCount, 2);
  });

  it("reports disconnected when the hub is unreachable", async () => {
    const ext = await import("../src/ext-client.js");
    const prev = process.env.MAILNOTMILK_HUB_URL;
    process.env.MAILNOTMILK_HUB_URL = "http://127.0.0.1:9"; // discard port
    try {
      const st = await ext.extStatus();
      assert.equal(st.connected, false);
      assert.equal(st.lastHello, null);
    } finally {
      if (prev === undefined) delete process.env.MAILNOTMILK_HUB_URL;
      else process.env.MAILNOTMILK_HUB_URL = prev;
    }
  });

  it("round-trips a command to the extension and back", async () => {
    const ext = await import("../src/ext-client.js");
    const seen = [];
    currentHandler = async (cmd) => {
      seen.push(cmd.type);
      if (cmd.type === "list_tabs") {
        return { tabs: [{ id: 7, url: "https://chatgpt.com/c/x", active: true }] };
      }
      return { ok: true };
    };

    const res = await ext.extListTabs();
    assert.deepEqual(seen, ["list_tabs"]);
    // Normalised to { tabs } so currentUrl() finds the array.
    assert.ok(Array.isArray(res.tabs), "extListTabs must return { tabs }");
    assert.equal(res.tabs[0].url, "https://chatgpt.com/c/x");
  });

  it("accepts a bare array from an older extension build", async () => {
    const ext = await import("../src/ext-client.js");
    currentHandler = async () => [
      { id: 3, url: "https://chat.deepseek.com/", active: true },
    ];

    const res = await ext.extListTabs();
    assert.ok(Array.isArray(res.tabs), "bare array must be normalised to { tabs }");
    assert.equal(res.tabs[0].id, 3);
  });

  it("propagates an extension-side error instead of hanging", async () => {
    const ext = await import("../src/ext-client.js");
    currentHandler = async () => {
      throw new Error("No suitable browser tab found");
    };

    await assert.rejects(
      () => ext.extSend({ text: "hi" }),
      /No suitable browser tab found/
    );
  });
});
