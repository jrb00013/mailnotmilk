import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectSiteFromUrl } from "../src/browser.js";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "browser.js"),
  "utf8"
);

/** Comments explaining a flag are not the same as passing it. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("browser launch args", () => {
  it("never passes Chromium switches to Firefox", () => {
    // Firefox treats an unrecognised argv entry as a URL, so this flag made it
    // open "http://automationcontrolled/" on every launch.
    const ffCall = SRC.slice(
      SRC.indexOf('if (name === "firefox")'),
      SRC.indexOf("_browser = _context.browser()")
    );
    const ffBranch = stripComments(ffCall.slice(0, ffCall.indexOf("} else {")));
    assert.ok(
      !ffBranch.includes("--disable-blink-features"),
      "firefox branch must not receive --disable-blink-features"
    );
    assert.ok(
      !ffBranch.includes("args"),
      "firefox branch must not set browser args at all"
    );
    assert.ok(
      ffBranch.includes("launchPersistentContext"),
      "sanity: found the firefox launch branch"
    );
  });

  it("still hardens Chromium against automation detection", () => {
    const chromeBranch = SRC.slice(
      SRC.indexOf("} else {", SRC.indexOf('if (name === "firefox")'))
    ).slice(0, 600);
    assert.ok(
      chromeBranch.includes("--disable-blink-features=AutomationControlled"),
      "chromium should keep the flag"
    );
  });

  it("builds base launch options with no args key at all", () => {
    const opts = SRC.slice(SRC.indexOf("const launchOpts = {"));
    const literal = opts.slice(0, opts.indexOf("};") + 2);
    assert.ok(!literal.includes("args:"), "shared launchOpts must not carry args");
  });
});

describe("on-the-fly site detection", () => {
  it("recognises a site the user navigated to, regardless of configured site", () => {
    // The relay may have been started with --site deepseek while the tab is on
    // ChatGPT; detection follows the URL.
    assert.equal(detectSiteFromUrl("https://chatgpt.com/c/xyz"), "chatgpt");
    assert.equal(detectSiteFromUrl("https://chat.deepseek.com/a/chat/s/1"), "deepseek");
  });

  it("exposes syncSiteFromUrl and currentUrl for per-tick adoption", async () => {
    const mod = await import("../src/browser.js");
    assert.equal(typeof mod.syncSiteFromUrl, "function");
    assert.equal(typeof mod.currentUrl, "function");
  });

  it("currentUrl is safe to call with nothing connected", async () => {
    const { currentUrl } = await import("../src/browser.js");
    assert.equal(await currentUrl(), null);
  });

  it("syncSiteFromUrl does not throw when disconnected", async () => {
    const { syncSiteFromUrl } = await import("../src/browser.js");
    const out = await syncSiteFromUrl();
    assert.equal(out.url, null);
    assert.equal(out.changed, false);
  });
});

describe("relay follows the tab", () => {
  const RELAY = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "relay.js"),
    "utf8"
  );

  it("syncs the site from the url each tick", () => {
    assert.ok(RELAY.includes("syncSiteFromUrl"), "relay must sync site per tick");
  });

  it("only navigates when the current page is not a recognised chat", () => {
    // Guard against a regression to unconditional browserOpenAi, which would
    // yank the tab away from wherever the user had navigated.
    const idx = RELAY.indexOf("const synced = await browser.syncSiteFromUrl()");
    assert.ok(idx > 0, "sync call present");
    const after = RELAY.slice(idx, idx + 400);
    assert.ok(
      after.includes("!synced.site || synced.site === \"custom\""),
      "navigation must be conditional on an unrecognised page"
    );
  });
});
