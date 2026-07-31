#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { dataDir, ensureDataDir } from "../src/paths.js";

ensureDataDir();
const userDataDir = join(dataDir(), "browser-profiles", "chromium");
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  viewport: { width: 1400, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const p = ctx.pages()[0] || (await ctx.newPage());
console.error("nav…", p.url());
await p.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 90_000 });
await new Promise((r) => setTimeout(r, 6000));
const probe = await p.evaluate(() => {
  const pick = (sel) =>
    Array.from(document.querySelectorAll(sel))
      .slice(0, 12)
      .map((el) => ({
        sel,
        role: el.getAttribute("data-message-author-role"),
        testid: el.getAttribute("data-testid"),
        tag: el.tagName,
        cls: (el.className || "").toString().slice(0, 100),
        text: (el.innerText || "").trim().slice(0, 140),
      }));
  return {
    url: location.href,
    title: document.title,
    bodyText: (document.body?.innerText || "").slice(0, 800),
    roleNodes: pick("[data-message-author-role]"),
    articles: pick("article"),
    turns: pick('[data-testid^="conversation-turn"]'),
    markdown: pick(".markdown"),
    composer: {
      prompt: !!document.querySelector("#prompt-textarea"),
      textarea: !!document.querySelector("textarea"),
      editable: !!document.querySelector('div[contenteditable="true"]'),
    },
  };
});
mkdirSync(join(dataDir(), "captures"), { recursive: true });
const shot = join(dataDir(), "captures", "chatgpt-probe.png");
await p.screenshot({ path: shot, fullPage: false });
writeFileSync(join(dataDir(), "captures", "dom-probe.json"), JSON.stringify(probe, null, 2));
console.log(JSON.stringify(probe, null, 2));
console.error("shot", shot);
await ctx.close();
