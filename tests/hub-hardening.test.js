import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, useDb, closeStore } from "../src/store.js";
import { createHubServer, clampTimeoutMs } from "../src/hub.js";
import { VERSION } from "../src/version.js";

describe("hub hardening", () => {
  let dir;
  let hub;
  let port;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "mnm-hub-hardening-"));
    process.env.MAILNOTMILK_DATA_DIR = dir;
    useDb(openStore(join(dir, "t.db")));
    // Tiny cap so the oversized-body case stays cheap to exercise.
    hub = createHubServer({ port: 0, maxBodyBytes: 100 });
    await new Promise((resolve) => hub.server.listen(0, "127.0.0.1", resolve));
    port = hub.server.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => hub.server.close(resolve));
    closeStore();
    delete process.env.MAILNOTMILK_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves a health check with the real version", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.name, "mailnotmilk");
    assert.equal(body.version, VERSION);
    assert.equal(typeof body.uptimeSeconds, "number");
  });

  it("answers malformed JSON with 400, not a misleading success", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"title":',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /invalid JSON/);
  });

  it("rejects a request body over the configured cap with 413", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(200) }),
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.match(body.error, /exceeds 100 bytes/);
  });

  it("still accepts a small valid request under the cap", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "ok", createdBy: "cursor" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.chat.id);
  });
});

describe("clampTimeoutMs", () => {
  it("clamps to the allowed window", () => {
    assert.equal(clampTimeoutMs("999999999"), 60_000);
    assert.equal(clampTimeoutMs("0"), 1_000);
    assert.equal(clampTimeoutMs(5_000, { max: 120_000 }), 5_000);
  });

  it("falls back for non-numeric input instead of waiting forever", () => {
    assert.equal(clampTimeoutMs("nope", { fallback: 1_234 }), 1_234);
    assert.equal(clampTimeoutMs(undefined, { fallback: 2_500 }), 2_500);
  });
});
