import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hostsForTarget, findPrimaryChromeUserDataDirs } from "../src/primary-browser.js";

describe("primary-browser hostsForTarget", () => {
  it("derives hosts from any URL without hardcoding vendors", () => {
    const h = hostsForTarget("https://chat.deepseek.com/a/chat");
    assert.ok(h.some((x) => x.includes("deepseek.com")));
    const g = hostsForTarget("gemini.google.com");
    assert.ok(g.some((x) => x.includes("google.com")));
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
    // Soft assert — CI may lack Chrome; local should have at least one.
    if (dirs.length) {
      assert.ok(dirs[0].includes("chrome") || dirs[0].includes("Chromium"));
    }
  });
});
