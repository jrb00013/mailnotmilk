import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allSites,
  listSites,
  siteConfig,
  detectSiteFromUrl,
  createTurnSettler,
} from "../src/browser.js";

describe("site resolution", () => {
  it("detects known sites from their own url", () => {
    assert.equal(detectSiteFromUrl("https://chatgpt.com/c/abc123"), "chatgpt");
    assert.equal(detectSiteFromUrl("https://chat.deepseek.com/a/chat/s/x"), "deepseek");
    assert.equal(detectSiteFromUrl("https://claude.ai/chat/999"), "claude");
    assert.equal(detectSiteFromUrl("https://gemini.google.com/app/abc"), "gemini");
    assert.equal(detectSiteFromUrl("https://copilot.microsoft.com/chats/1"), "copilot");
  });

  it("honours aliases for a second domain of the same product", () => {
    assert.equal(detectSiteFromUrl("https://chat.openai.com/c/abc"), "chatgpt");
  });

  it("matches subdomains but not suffix lookalikes", () => {
    assert.equal(detectSiteFromUrl("https://eu.chatgpt.com/c/1"), "chatgpt");
    // The dangerous case: a domain that merely ends with the same text.
    assert.equal(detectSiteFromUrl("https://notchatgpt.com/c/1"), null);
    assert.equal(detectSiteFromUrl("https://chatgpt.com.evil.test/c/1"), null);
  });

  it("returns null for unknown or junk urls instead of throwing", () => {
    assert.equal(detectSiteFromUrl("https://example.com/chat"), null);
    assert.equal(detectSiteFromUrl("not a url"), null);
    assert.equal(detectSiteFromUrl(""), null);
    assert.equal(detectSiteFromUrl(null), null);
  });

  it("gives every site a complete profile, falling back to generic", () => {
    for (const key of listSites()) {
      const cfg = siteConfig(key);
      for (const field of [
        "messageSelectors",
        "composerSelectors",
        "sendSelectors",
        "stopSelectors",
      ]) {
        assert.ok(Array.isArray(cfg[field]) && cfg[field].length, `${key}.${field}`);
      }
    }
  });

  it("gives an unknown/custom site a working generic profile", () => {
    const cfg = siteConfig("custom");
    assert.ok(cfg.composerSelectors.length, "composer");
    assert.ok(cfg.sendSelectors.length, "send");
    // Without this, an unrecognised site has no completion signal at all and
    // silently falls back to the truncating behaviour.
    assert.ok(cfg.stopSelectors.length, "stop");
  });

  it("site overrides win over generic but do not erase other fields", () => {
    const chatgpt = siteConfig("chatgpt");
    assert.ok(chatgpt.messageSelectors.includes(".agent-turn"), "site override applied");
    assert.ok(chatgpt.stopSelectors.length, "stop selectors present");
  });

  it("derives matching from url — no hand-written host regexes", () => {
    for (const [key, cfg] of Object.entries(allSites())) {
      assert.ok(cfg.url, `${key} has a url`);
      assert.equal(cfg.match, undefined, `${key} should not carry a hand-written match`);
      // Every site must recognise the very url it ships with.
      assert.equal(detectSiteFromUrl(cfg.url), key, `${key} detects its own url`);
    }
  });
});

describe("turn settler (streaming completion)", () => {
  const PREV = "an earlier answer";

  it("does not settle on a partial that is still growing", () => {
    const s = createTurnSettler({ prevText: PREV, idleMs: 1000 });
    assert.equal(s.observe({ text: "Approach 1", generating: true, now: 0 }), null);
    assert.equal(s.observe({ text: "Approach 1, 2", generating: true, now: 500 }), null);
    assert.equal(s.observe({ text: "Approach 1, 2, 3", generating: true, now: 1000 }), null);
  });

  it("does not settle on a mid-stream pause longer than the idle window", () => {
    // This is the exact bug: text stops growing briefly, but the stream is live.
    const s = createTurnSettler({ prevText: PREV, idleMs: 1000 });
    assert.equal(s.observe({ text: "half an answer", generating: true, now: 0 }), null);
    assert.equal(s.observe({ text: "half an answer", generating: true, now: 5000 }), null);
  });

  it("settles once text is quiet and the page reports not generating", () => {
    const s = createTurnSettler({ prevText: PREV, idleMs: 1000 });
    s.observe({ text: "the full answer", generating: true, now: 0 });
    const done = s.observe({ text: "the full answer", generating: false, now: 1500 });
    assert.ok(done);
    assert.equal(done.settled, true);
    assert.equal(done.text, "the full answer");
    assert.equal(done.reason, "idle+not-generating");
  });

  it("ignores the previous turn — only a new answer can settle", () => {
    const s = createTurnSettler({ prevText: PREV, idleMs: 1000 });
    assert.equal(s.observe({ text: PREV, generating: false, now: 0 }), null);
    assert.equal(s.observe({ text: PREV, generating: false, now: 9000 }), null);
  });

  it("requires a doubled quiet window when generating state is unknown", () => {
    const s = createTurnSettler({ prevText: PREV, idleMs: 1000 });
    s.observe({ text: "answer", generating: null, now: 0 });
    assert.equal(s.observe({ text: "answer", generating: null, now: 1500 }), null);
    const done = s.observe({ text: "answer", generating: null, now: 2500 });
    assert.ok(done);
    assert.equal(done.reason, "idle-only");
  });

  it("resets the idle clock when more text streams in", () => {
    const s = createTurnSettler({ prevText: PREV, idleMs: 1000 });
    s.observe({ text: "part one", generating: false, now: 0 });
    s.observe({ text: "part one and two", generating: false, now: 900 });
    // 900ms since the change, not 1800 since the start.
    assert.equal(s.observe({ text: "part one and two", generating: false, now: 1700 }), null);
    const done = s.observe({ text: "part one and two", generating: false, now: 2000 });
    assert.equal(done.text, "part one and two");
  });

  it("give_up surfaces a partial and flags it as unsettled", () => {
    const s = createTurnSettler({ prevText: PREV, idleMs: 1000 });
    s.observe({ text: "truncated...", generating: true, now: 0 });
    const out = s.give_up();
    assert.equal(out.settled, false);
    assert.equal(out.reason, "timeout-mid-stream");
    assert.equal(out.text, "truncated...");
  });

  it("give_up returns null when nothing new ever arrived", () => {
    const s = createTurnSettler({ prevText: PREV, idleMs: 1000 });
    s.observe({ text: PREV, generating: false, now: 0 });
    assert.equal(s.give_up(), null);
  });
});
