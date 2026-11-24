import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveBrowserConnectMode } from "../src/browser.js";

describe("resolveBrowserConnectMode", () => {
  it("never returns extension when extension is offline", async () => {
    const picked = await resolveBrowserConnectMode({
      mode: "auto",
      extStatusFn: async () => ({ connected: false, lastHello: null }),
      ensureChromeCdpFn: async () => ({
        ok: true,
        started: true,
        cdpUrl: "http://127.0.0.1:9222",
      }),
    });
    assert.equal(picked.mode, "cdp");
    assert.match(picked.reason, /cdp/);
  });

  it("prefers live extension when hub says hello", async () => {
    const picked = await resolveBrowserConnectMode({
      mode: "auto",
      extStatusFn: async () => ({ connected: true, lastHello: Date.now() }),
      ensureChromeCdpFn: async () => {
        throw new Error("should not start CDP when extension is live");
      },
    });
    assert.equal(picked.mode, "extension");
  });

  it("falls back to playwright launch when CDP cannot start", async () => {
    const picked = await resolveBrowserConnectMode({
      mode: "auto",
      extStatusFn: async () => ({ connected: false, lastHello: null }),
      ensureChromeCdpFn: async () => ({
        ok: false,
        error: "Chrome/Chromium binary not found",
      }),
    });
    assert.equal(picked.mode, "launch");
    assert.match(picked.reason, /playwright-/);
  });

  it("requests headless CDP by default (port 9223)", async () => {
    let seen = null;
    const picked = await resolveBrowserConnectMode({
      mode: "auto",
      extStatusFn: async () => ({ connected: false, lastHello: null }),
      ensureChromeCdpFn: async (opts) => {
        seen = opts;
        return { ok: true, started: true, cdpUrl: "http://127.0.0.1:9223", headless: true };
      },
    });
    assert.equal(picked.mode, "cdp");
    assert.equal(seen.headless, true);
    assert.match(seen.cdpUrl, /9223/);
    assert.match(picked.reason, /cdp-headless/);
  });

  it("honors explicit mode", async () => {
    const picked = await resolveBrowserConnectMode({ mode: "launch" });
    assert.equal(picked.mode, "launch");
    assert.equal(picked.reason, "explicit");
  });
});
