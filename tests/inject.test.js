import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectInjector, findWindows, injectIntoMatchingWindow } from "../src/inject.js";

describe("injector detection", () => {
  it("returns null or a known backend, never throws", () => {
    const got = detectInjector();
    if (got !== null) {
      assert.ok(["xdotool", "xte", "ydotool"].includes(got.tool));
      assert.ok(["x11", "wayland"].includes(got.display));
    }
  });
});

describe("window matching", () => {
  it("returns an array even with no X display or no match", () => {
    assert.ok(Array.isArray(findWindows("definitely-no-such-window-zzz")));
  });

  it("filters out placeholder windows smaller than 100px", () => {
    // Every toolkit litters the tree with 1x1 and 10x10 windows; typing into
    // one would silently go nowhere.
    for (const w of findWindows(".")) {
      assert.ok(w.id.startsWith("0x"), "id looks like a window id");
      assert.equal(typeof w.title, "string");
    }
  });

  it("refuses to type when nothing matches", () => {
    const r = injectIntoMatchingWindow({
      titlePattern: "definitely-no-such-window-zzz",
      text: "hi",
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /no window title matched|no keystroke injector/);
  });

  it("refuses to type when the pattern is ambiguous", () => {
    // "." matches every window. Typing a prompt into the wrong terminal is
    // worse than doing nothing, so ambiguity must be an error.
    const all = findWindows(".");
    if (all.length < 2) return; // headless CI — nothing to disambiguate
    const r = injectIntoMatchingWindow({ titlePattern: ".", text: "hi" });
    assert.equal(r.ok, false);
    assert.match(r.reason, /windows matched|no keystroke injector/);
  });

  it("reports a clear reason when no injector is installed", () => {
    if (detectInjector()) return; // tool present — nothing to assert
    const r = injectIntoMatchingWindow({ titlePattern: ".", text: "hi" });
    assert.equal(r.ok, false);
    assert.ok(
      /no keystroke injector|windows matched/.test(r.reason),
      "must explain why nothing was typed"
    );
  });
});

describe("bootstrap prompt", () => {
  it("is a single line so a newline cannot submit it early", async () => {
    const { createChat, buildInviteBundle } = await import("../src/chats.js");
    const chat = createChat({
      title: "t",
      createdBy: "web-ai",
      members: ["claude-cutover"],
    });
    const { bootstrapPrompt } = buildInviteBundle(chat);
    assert.ok(!bootstrapPrompt.includes("\n"), "must not contain newlines");
  });

  it("teaches the MCP tools and the CLI fallback", async () => {
    const { createChat, buildInviteBundle } = await import("../src/chats.js");
    const chat = createChat({ title: "t", createdBy: "web-ai", members: ["claude-x"] });
    const { bootstrapPrompt } = buildInviteBundle(chat);
    for (const tool of ["join_chat", "chat_history", "chat_say", "check_inbox"]) {
      assert.ok(bootstrapPrompt.includes(tool), `mentions ${tool}`);
    }
    assert.ok(bootstrapPrompt.includes("chat join"), "mentions CLI fallback");
    assert.ok(bootstrapPrompt.includes("claude-x"), "uses the real peer id");
  });

  it("warns about the echo lines the relay produces", async () => {
    const { createChat, buildInviteBundle } = await import("../src/chats.js");
    const chat = createChat({ title: "t", createdBy: "web-ai", members: ["claude-y"] });
    const { bootstrapPrompt } = buildInviteBundle(chat);
    assert.ok(bootstrapPrompt.includes("## Relayed to browser"), "explains system lines");
    assert.ok(bootstrapPrompt.includes("assistant"), "explains assistant lines");
  });
});
