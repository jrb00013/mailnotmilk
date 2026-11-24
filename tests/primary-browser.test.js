import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hostsForTarget,
  findPrimaryChromeUserDataDirs,
  findPrimaryFirefoxProfileDir,
  extractFirefoxCookies,
  scoreSessionCookies,
} from "../src/primary-browser.js";

describe("primary-browser hostsForTarget", () => {
  it("derives hosts from any URL without hardcoding vendors", () => {
    const h = hostsForTarget("https://chat.example.com/a/chat");
    assert.ok(h.some((x) => x.includes("example.com")));
    const g = hostsForTarget("app.other.test");
    assert.ok(g.some((x) => x.includes("other.test")));
  });

  it("handles bare host and multi-label hosts the same way", () => {
    const h = hostsForTarget("https://chat.example.co.uk/room");
    assert.ok(h.some((x) => x.includes("example.co.uk") || x.includes("chat.example")));
  });
});

describe("primary-browser discovery", () => {
  it("finds user-data dirs when Chrome is installed", () => {
    const dirs = findPrimaryChromeUserDataDirs();
    assert.ok(Array.isArray(dirs));
    if (dirs.length) {
      assert.ok(dirs[0].includes("chrome") || dirs[0].includes("Chromium"));
    }
  });

  it("finds Firefox profile when present (snap or system)", () => {
    const ff = findPrimaryFirefoxProfileDir();
    if (ff.ok) {
      assert.ok(ff.profileDir);
      assert.match(ff.browser, /firefox/);
    } else {
      assert.ok(ff.error);
    }
  });

  it("scores session cookies higher than crumbs", () => {
    const low = scoreSessionCookies([{ name: "_ga", value: "x" }]);
    const high = scoreSessionCookies([
      { name: "__Secure-next-auth.session-token.0", value: "a".repeat(200) },
    ]);
    assert.ok(high > low);
  });

  it("extracts firefox cookies for a target host when profile exists", () => {
    const ff = findPrimaryFirefoxProfileDir();
    if (!ff.ok) return;
    const jar = extractFirefoxCookies({
      targets: ["https://example.com"],
      profileDir: ff.profileDir,
    });
    assert.equal(jar.browser, "firefox");
    assert.ok(Array.isArray(jar.cookies));
  });
});
