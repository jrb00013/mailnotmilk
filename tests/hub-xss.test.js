import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, useDb, closeStore } from "../src/store.js";
import { createHubServer } from "../src/hub.js";

describe("hub chat page escaping", () => {
  let dir;
  let hub;
  let port;
  let chat;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "mnm-hub-xss-"));
    process.env.MAILNOTMILK_DATA_DIR = dir;
    useDb(openStore(join(dir, "t.db")));
    hub = createHubServer({ port: 0 });
    await new Promise((resolve) => hub.server.listen(0, "127.0.0.1", resolve));
    port = hub.server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: '<img src=x onerror="alert(1)">',
        createdBy: "cursor",
      }),
    });
    chat = await res.json();
  });

  afterEach(async () => {
    await new Promise((resolve) => hub.server.close(resolve));
    closeStore();
    delete process.env.MAILNOTMILK_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  const page = (query = "") =>
    fetch(
      `http://127.0.0.1:${port}/c/${chat.chat.id}?invite=${chat.inviteToken}${query}`
    ).then((r) => r.text());

  it("escapes the chat title instead of rendering it as markup", async () => {
    const html = await page();
    assert.ok(!html.includes('<img src=x onerror="alert(1)">'), "raw title must not render");
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });

  it("escapes message text", async () => {
    await fetch(`http://127.0.0.1:${port}/api/chats/${chat.chat.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "cursor", text: "<script>alert(2)</script>" }),
    });
    const html = await page();
    assert.ok(!html.includes("<script>alert(2)</script>"));
    assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  });

  it("cannot be broken out of with a crafted invite query string", async () => {
    const payload = "</script><script>alert(3)</script>";
    const html = await fetch(
      `http://127.0.0.1:${port}/c/${chat.chat.id}?invite=${encodeURIComponent(payload)}`
    ).then((r) => r.text());
    assert.ok(!html.includes("</script><script>alert(3)"));
    // Embedded JSON escapes `<` so it cannot close the script element.
    assert.match(html, /\\u003c\/script\\u003e/);
  });

  it("has no inline onclick handlers to inject into", async () => {
    const html = await page();
    assert.ok(!html.includes("onclick="), "copy buttons must use data attributes");
    assert.match(html, /data-copy-from="peer"/);
  });
});
