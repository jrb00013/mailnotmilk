/**
 * Chrome / Firefox automation for web AI chats (ChatGPT, DeepSeek, …).
 * Prefer mailnotmilk Chrome extension (normal Chrome shortcut, any site).
 * Fallback: CDP / Playwright.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir, ensureDataDir } from "./paths.js";
import * as ext from "./ext-bridge.js";

let _pw = null;
let _browser = null;
let _context = null;
let _page = null;
let _meta = { browser: null, site: null, cdp: false, mode: null, tabId: null };

const SITES = {
  chatgpt: {
    url: "https://chatgpt.com/",
    messageSelectors: [
      "[data-message-author-role]",
      'article[data-testid^="conversation-turn"]',
      '[data-testid^="conversation-turn"]',
      "div[data-message-id]",
      ".agent-turn",
      ".markdown",
      "[class*='markdown']",
    ],
    roleAttr: "data-message-author-role",
    composerSelectors: [
      "#prompt-textarea",
      "div#prompt-textarea",
      'div[contenteditable="true"]#prompt-textarea',
      'div.ProseMirror[contenteditable="true"]',
      'textarea[data-id="root"]',
      "form textarea",
      'div[contenteditable="true"]',
    ],
    sendSelectors: [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
    ],
  },
  deepseek: {
    url: "https://chat.deepseek.com/",
    messageSelectors: [
      ".ds-message",
      "[class*='message']",
      ".chat-message",
      "div[data-message-id]",
    ],
    composerSelectors: [
      "textarea",
      'div[contenteditable="true"]',
      "#chat-input",
    ],
    sendSelectors: [
      'button[aria-label*="Send"]',
      'div[role="button"][aria-label*="Send"]',
      "button:has(svg)",
    ],
  },
  claude: {
    url: "https://claude.ai/new",
    messageSelectors: [
      "[data-test-render-count]",
      ".font-claude-message",
      "[class*='Message']",
    ],
    composerSelectors: [
      'div[contenteditable="true"]',
      "fieldset textarea",
      "p[data-placeholder]",
    ],
    sendSelectors: [
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
    ],
  },
  gemini: {
    url: "https://gemini.google.com/app",
    messageSelectors: [
      "message-content",
      ".model-response-text",
      "[data-message-id]",
    ],
    composerSelectors: [
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"]',
    ],
    sendSelectors: [
      'button[aria-label="Send message"]',
      "button.send-button",
    ],
  },
  copilot: {
    url: "https://copilot.microsoft.com/",
    messageSelectors: [
      "[data-content='ai-message']",
      "[data-content='user-message']",
      ".group\\/ai-message-item",
    ],
    composerSelectors: [
      "#userInput",
      "textarea#userInput",
      "textarea[placeholder]",
    ],
    sendSelectors: [
      'button[aria-label="Submit"]',
      'button[type="submit"]',
    ],
  },
};

export function listSites() {
  return Object.keys(SITES);
}

async function loadPlaywright() {
  if (_pw) return _pw;
  try {
    _pw = await import("playwright");
    return _pw;
  } catch {
    const err = new Error(
      "Playwright not installed. Run ./install.sh (or install.cmd / install.ps1) — it auto-installs browsers."
    );
    err.code = "PLAYWRIGHT_MISSING";
    throw err;
  }
}

export function browserStatus() {
  return {
    connected:
      _meta.mode === "extension"
        ? Boolean(ext.extStatus().connected || ext.extStatus().lastHello)
        : Boolean(_page),
    browser: _meta.browser,
    site: _meta.site,
    cdp: _meta.cdp,
    mode: _meta.mode,
    tabId: _meta.tabId,
    extension: ext.extStatus(),
    url: _page ? _page.url() : null,
  };
}

export async function browserConnect({
  browser = "chrome",
  mode = "launch",
  cdpUrl = "http://127.0.0.1:9222",
  headless = true,
  profileDir = null,
} = {}) {
  await browserDisconnect();
  const name = browser === "firefox" ? "firefox" : "chromium";

  if (mode === "extension") {
    _meta = {
      browser: "chrome-extension",
      site: null,
      cdp: false,
      mode: "extension",
      tabId: null,
    };
    return browserStatus();
  }

  const pw = await loadPlaywright();
  _meta = { browser: name, site: null, cdp: mode === "cdp", mode, tabId: null };

  if (mode === "cdp") {
    if (name !== "chromium") {
      throw new Error("CDP attach is Chromium/Chrome only; use mode=launch for Firefox");
    }
    _browser = await pw.chromium.connectOverCDP(cdpUrl);
    const contexts = _browser.contexts();
    _context = contexts[0] || (await _browser.newContext());
    const pages = _context.pages();
    // Prefer an existing ChatGPT tab if present
    _page =
      pages.find((pg) =>
        /chatgpt\.com|chat\.openai\.com|deepseek\.com|gemini\.google|claude\.ai|copilot\.microsoft/i.test(
          pg.url()
        )
      ) ||
      pages[0] ||
      (await _context.newPage());
  } else {
    ensureDataDir();
    const userDataDir =
      profileDir || join(dataDir(), "browser-profiles", name);
    mkdirSync(userDataDir, { recursive: true });
    const launchOpts = {
      headless: Boolean(headless),
      viewport: { width: 1400, height: 900 },
      args: ["--disable-blink-features=AutomationControlled"],
    };
    if (name === "firefox") {
      _context = await pw.firefox.launchPersistentContext(userDataDir, launchOpts);
    } else {
      // System Chrome — Cloudflare blocks Playwright's bundled Chromium hard
      try {
        _context = await pw.chromium.launchPersistentContext(userDataDir, {
          ...launchOpts,
          channel: "chrome",
        });
      } catch {
        _context = await pw.chromium.launchPersistentContext(userDataDir, launchOpts);
      }
    }
    _browser = _context.browser();
    _page = _context.pages()[0] || (await _context.newPage());
  }

  return browserStatus();
}

export async function browserDisconnect() {
  try {
    if (_meta.mode === "extension") {
      /* keep extension */
    } else if (_context && _meta.cdp === false) await _context.close();
    else if (_browser) await _browser.close();
  } catch {
    /* ignore */
  }
  _pw = _pw;
  _browser = null;
  _context = null;
  _page = null;
  _meta = { browser: null, site: null, cdp: false, mode: null, tabId: null };
  return { ok: true };
}

function requirePage() {
  if (_meta.mode === "extension") {
    throw new Error("internal: Playwright page requested while in extension mode");
  }
  if (!_page) throw new Error("Not connected — call browser_connect first");
  return _page;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function urlIncludesForSite(site) {
  const map = {
    chatgpt: "chatgpt\\.com|chat\\.openai\\.com",
    deepseek: "deepseek\\.com",
    claude: "claude\\.ai",
    gemini: "gemini\\.google\\.com",
    copilot: "copilot\\.microsoft\\.com",
  };
  return map[site] || null;
}

/** True when Cloudflare / bot-check interstitial is showing. */
export async function isCloudflareChallenge() {
  if (_meta.mode === "extension") {
    try {
      const data = await ext.extEval({
        tabId: _meta.tabId,
        code: `(() => {
          const t = (document.title + " " + (document.body && document.body.innerText || "")).toLowerCase();
          if (t.includes("just a moment") || t.includes("verify you are human")) return true;
          if (document.querySelector("#challenge-stage, #cf-challenge-running, .cf-turnstile, iframe[src*='challenges.cloudflare']")) return true;
          return false;
        })()`,
      });
      return Boolean(data);
    } catch {
      return false;
    }
  }
  const page = requirePage();
  return page.evaluate(() => {
    const t = `${document.title || ""} ${(document.body && document.body.innerText) || ""}`.toLowerCase();
    if (t.includes("just a moment") || t.includes("verify you are human")) return true;
    if (document.querySelector("#challenge-stage, #cf-challenge-running, .cf-turnstile, iframe[src*='challenges.cloudflare']"))
      return true;
    return false;
  });
}

/**
 * Wait until Cloudflare clears (user clicks the checkbox).
 * Returns { ok, waitedMs, challenge }.
 */
export async function waitForCloudflareClear({ timeoutMs = 180_000 } = {}) {
  if (_meta.mode === "extension") {
    const start = Date.now();
    let challenge = await isCloudflareChallenge();
    if (!challenge) return { ok: true, waitedMs: 0, challenge: false };
    console.error(
      "browser: Cloudflare challenge in your Chrome tab — click Verify you are human."
    );
    while (Date.now() - start < timeoutMs) {
      await sleep(1500);
      if (!(await isCloudflareChallenge())) {
        return { ok: true, waitedMs: Date.now() - start, challenge: true };
      }
    }
    return { ok: false, waitedMs: Date.now() - start, challenge: true };
  }
  const page = requirePage();
  const start = Date.now();
  let challenge = await isCloudflareChallenge();
  if (!challenge) return { ok: true, waitedMs: 0, challenge: false };

  console.error(
    "browser: Cloudflare challenge detected — click “Verify you are human” in the Chrome window."
  );
  while (Date.now() - start < timeoutMs) {
    await sleep(1500);
    challenge = await isCloudflareChallenge();
    if (!challenge) {
      await sleep(2000);
      console.error("browser: Cloudflare cleared");
      return { ok: true, waitedMs: Date.now() - start, challenge: true };
    }
    const hasComposer = await page
      .locator('#prompt-textarea, div[contenteditable="true"], textarea')
      .first()
      .count()
      .catch(() => 0);
    if (hasComposer > 0 && !(await isCloudflareChallenge())) {
      return { ok: true, waitedMs: Date.now() - start, challenge: true };
    }
  }
  return { ok: false, waitedMs: Date.now() - start, challenge: true };
}

export async function browserOpenAi({ site = "deepseek", url = null } = {}) {
  let target = url;
  let siteKey = site;
  if (!target) {
    const cfg = SITES[site];
    if (!cfg) throw new Error(`Unknown site ${site}. Known: ${listSites().join(", ")}`);
    target = cfg.url;
    siteKey = site;
  } else {
    siteKey = site || "custom";
  }

  if (_meta.mode === "extension") {
    const includes = urlIncludesForSite(siteKey);
    let focused = null;
    try {
      focused = await ext.extFocusTab({ urlIncludes: includes });
    } catch {
      focused = null;
    }
    if (!focused || !includes || !new RegExp(includes, "i").test(focused.url || "")) {
      focused = await ext.extOpenUrl({ url: target });
    }
    _meta.site = siteKey;
    _meta.tabId = focused.tabId;
    const cf = await waitForCloudflareClear({ timeoutMs: 180_000 });
    return {
      ...browserStatus(),
      title: focused.title || null,
      url: focused.url || target,
      cloudflare: cf,
    };
  }

  const page = requirePage();
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(1500);
  _meta.site = siteKey;

  const cf = await waitForCloudflareClear({ timeoutMs: 180_000 });
  if (!cf.ok) {
    console.error(
      "browser: still on Cloudflare after timeout — messages will not extract until you pass the check"
    );
  }

  return { ...browserStatus(), title: await page.title(), cloudflare: cf };
}

async function firstSelector(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) return loc;
  }
  return null;
}

export async function browserExtractMessages({ limit = 40 } = {}) {
  if (_meta.mode === "extension") {
    if (await isCloudflareChallenge()) {
      return {
        site: _meta.site,
        url: null,
        count: 0,
        messages: [],
        lastAssistant: null,
        lastUser: null,
        blocked: "cloudflare",
        error:
          "Cloudflare challenge is showing — click Verify you are human in Chrome, then retry.",
      };
    }
    const data = await ext.extExtract({ tabId: _meta.tabId, limit });
    if (data?.tabId) _meta.tabId = data.tabId;
    return {
      site: _meta.site,
      ...data,
    };
  }

  const page = requirePage();
  if (await isCloudflareChallenge()) {
    return {
      site: _meta.site,
      url: page.url(),
      count: 0,
      messages: [],
      lastAssistant: null,
      lastUser: null,
      blocked: "cloudflare",
      error:
        "Cloudflare challenge is showing — click Verify you are human in the browser window, then retry.",
    };
  }

  const site = _meta.site && SITES[_meta.site] ? SITES[_meta.site] : null;
  const selectors = site?.messageSelectors || [
    "[data-message-author-role]",
    ".ds-message",
    "article",
    "[class*='message']",
  ];

  const messages = await page.evaluate(
    ({ selectors, roleAttr, limit }) => {
      const out = [];
      const seen = new Set();

      const push = (role, text) => {
        const t = (text || "").trim();
        if (!t || t.length < 2) return;
        const key = `${role}:${t.slice(0, 160)}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ role, text: t.slice(0, 8000) });
      };

      for (const sel of selectors) {
        const nodes = Array.from(document.querySelectorAll(sel));
        for (const el of nodes) {
          let role = el.getAttribute(roleAttr || "data-message-author-role");
          if (!role) {
            const named = el.querySelector?.("[data-message-author-role]");
            if (named) role = named.getAttribute("data-message-author-role");
          }
          if (!role) {
            const testid = (el.getAttribute("data-testid") || "").toLowerCase();
            const cls = (el.className || "").toString().toLowerCase();
            if (testid.includes("user") || cls.includes("user") || cls.includes("human"))
              role = "user";
            else if (
              testid.includes("assistant") ||
              cls.includes("assistant") ||
              cls.includes("agent-turn") ||
              cls.includes("model")
            )
              role = "assistant";
            else role = "unknown";
          }
          // Prefer inner message body over whole turn chrome
          const body =
            el.querySelector?.(".markdown, .prose, [class*='markdown']") || el;
          push(role, body.innerText || body.textContent || "");
        }
        if (out.length) break;
      }

      // Fallback: any role-tagged nodes anywhere
      if (!out.length) {
        for (const el of document.querySelectorAll("[data-message-author-role]")) {
          push(
            el.getAttribute("data-message-author-role") || "unknown",
            el.innerText || el.textContent || ""
          );
        }
      }

      return out.slice(-limit);
    },
    {
      selectors,
      roleAttr: site?.roleAttr || "data-message-author-role",
      limit: Math.min(Math.max(Number(limit) || 40, 1), 100),
    }
  );

  return {
    site: _meta.site,
    url: page.url(),
    count: messages.length,
    messages,
    lastAssistant: [...messages].reverse().find((m) => m.role === "assistant") || null,
    lastUser: [...messages].reverse().find((m) => m.role === "user") || null,
  };
}

export async function browserSendMessage({ text, submit = true } = {}) {
  if (!text) throw new Error("text required");
  if (_meta.mode === "extension") {
    if (await isCloudflareChallenge()) {
      throw new Error(
        "Cloudflare challenge is showing — click Verify you are human, then retry send."
      );
    }
    const data = await ext.extSend({ text, tabId: _meta.tabId, submit });
    if (data?.tabId) _meta.tabId = data.tabId;
    return { ok: true, site: _meta.site, ...data };
  }
  const page = requirePage();
  if (await isCloudflareChallenge()) {
    throw new Error(
      "Cloudflare challenge is showing — click Verify you are human, then retry send."
    );
  }
  const site = _meta.site && SITES[_meta.site] ? SITES[_meta.site] : null;
  const composers = site?.composerSelectors || [
    "textarea",
    'div[contenteditable="true"]',
  ];
  const composer = await firstSelector(page, composers);
  if (!composer) throw new Error("Could not find chat composer on page");

  await composer.click({ timeout: 10_000 });
  const handle = await composer.elementHandle();
  const tag = await handle.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "textarea" || tag === "input") {
    await composer.fill(text);
  } else {
    await page.keyboard.insertText(text);
  }

  if (submit) {
    const senders = site?.sendSelectors || [
      'button[aria-label*="Send"]',
      'button[type="submit"]',
    ];
    const sendBtn = await firstSelector(page, senders);
    if (sendBtn) {
      await sendBtn.click({ timeout: 5000 }).catch(async () => {
        await page.keyboard.press("Enter");
      });
    } else {
      await page.keyboard.press("Enter");
    }
    await sleep(1200);
  }

  return { ok: true, site: _meta.site, url: page.url() };
}

export async function browserScreenshot({ path = null } = {}) {
  const page = requirePage();
  ensureDataDir();
  const out = path || join(dataDir(), "captures", `browser-${Date.now()}.png`);
  mkdirSync(join(dataDir(), "captures"), { recursive: true });
  await page.screenshot({ path: out, fullPage: false });
  return { path: out, url: page.url() };
}

export { SITES };
