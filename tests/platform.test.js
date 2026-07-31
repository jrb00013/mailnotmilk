import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, playwrightResolvable } from "../src/playwright-setup.js";

describe("playwright-setup platform", () => {
  it("detects a known env", () => {
    const p = detectPlatform();
    assert.ok(
      ["windows-native", "windows-wsl", "linux-native", "macos"].includes(p.env),
      `unexpected env ${p.env}`
    );
    assert.ok(p.os);
    assert.ok(p.arch);
  });

  it("playwrightResolvable reflects package presence", () => {
    assert.equal(typeof playwrightResolvable(), "boolean");
  });
});
