/**
 * Chrome / Firefox automation for web AI chats (ChatGPT, DeepSeek, …).
 * Prefer mailnotmilk Chrome extension (normal Chrome shortcut, any site).
 * Fallback: CDP / Playwright.
 */

import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, ensureDataDir } from "./paths.js";
import * as ext from "./ext-bridge.js";

let _pw = null;
let _browser = null;
let _context = null;
let _page = null;
let _meta = { browser: null, site: null, cdp: false, mode: null, tabId: null };

/**
 * Cross-site fallbacks. Any URL works without a dedicated entry — a site block
 * only overrides what it actually needs, and anything it omits falls back here.
 * Accessible names and roles are preferred over hashed classes because they
 * survive frontend redesigns.
 */
const GENERIC = {
  messageSelectors: [
    "[data-message-author-role]",
    "[data-testid^='conversation-turn']",
    "[data-message-id]",
    "[class*='message']",
    "[role='listitem']",
    "article",
  ],
  roleAttr: "data-message-author-role",
  composerSelectors: [
    "[contenteditable='true']",
    "textarea:not([readonly])",
    "[role='textbox']",
    "input[type='text']",
  ],
  sendSelectors: [
    "button[aria-label*='Send' i]",
    "button[data-testid*='send' i]",
    "button[type='submit']",
    "[role='button'][aria-label*='Send' i]",
  ],
  stopSelectors: [
    "button[aria-label*='Stop' i]",
    "button[data-testid*='stop' i]",
    "[role='button'][aria-label*='Stop' i]",
  ],
};

const SITES = {
  chatgpt: {
    url: "https://chatgpt.com/",
    aliases: ["chat.openai.com"],
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
    // Present only while a turn is streaming. Accessible names first — they
    // survive redesigns better than hashed classes or test ids.
    stopSelectors: [
      'button[aria-label="Stop streaming"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label*="Stop"]',
      'button[data-testid="stop-button"]',
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

/**
 * User-defined sites from ~/.mailnotmilk/sites.json, so a new chat UI does not
 * require a code change. Same shape as a SITES entry:
 *   { "myai": { "url": "https://…", "sendSelectors": [...] } }
 * Anything omitted falls back to GENERIC.
 */
function userSites() {
  try {
    const path = join(dataDir(), "sites.json");
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.error(`browser: ignoring sites.json — ${err.message}`);
    return {};
  }
}

export function allSites() {
  return { ...SITES, ...userSites() };
}

export function listSites() {
  return Object.keys(allSites());
}

/**
 * Resolved config for a site key. Unknown keys (including "custom" for a bare
 * URL) still get a full working profile from GENERIC rather than nothing.
 */
export function siteConfig(key) {
  const site = allSites()[key] || {};
  return { ...GENERIC, ...site };
}

/**
 * Hostnames a site answers to, derived from its own `url` plus any `aliases`.
 * Nothing is hand-written twice: change the url and matching follows. Aliases
 * exist only for genuinely different domains serving the same product.
 */
function hostsForSite(cfg) {
  const hosts = [];
  for (const candidate of [cfg?.url, ...(cfg?.aliases || [])]) {
    if (!candidate) continue;
    try {
      hosts.push(new URL(candidate.includes("://") ? candidate : `https://${candidate}`).hostname);
    } catch {
      /* unparseable entry — skip */
    }
  }
  return hosts;
}

/** Match a URL against a host, allowing subdomains but not suffix spoofing. */
function urlHasHost(url, host) {
  try {
    const actual = new URL(url).hostname.toLowerCase();
    const want = host.toLowerCase();
    return actual === want || actual.endsWith(`.${want}`);
  } catch {
    return false;
  }
}

/** Substring the extension uses to find a tab; plain host, not a regex. */
function urlIncludesForSite(key) {
  return hostsForSite(allSites()[key])[0] || null;
}

/** Best-guess site key for any URL; null when nothing matches. */
export function detectSiteFromUrl(url) {
  if (!url) return null;
  for (const [key, cfg] of Object.entries(allSites())) {
    if (hostsForSite(cfg).some((host) => urlHasHost(url, host))) return key;
  }
  return null;
}

/** Does this URL belong to any site we know about? */
function isKnownSiteUrl(url) {
  return detectSiteFromUrl(url) !== null;
}

/** URL of whatever page we are currently driving, or null. */
export async function currentUrl() {
  if (_meta.mode === "extension") {
    try {
      const tabs = (await ext.extListTabs())?.tabs || [];
      const mine = _meta.tabId
        ? tabs.find((t) => t.id === _meta.tabId || t.tabId === _meta.tabId)
        : null;
      return (mine || tabs.find((t) => t.active) || null)?.url || null;
    } catch {
      return null;
    }
  }
  return _page ? _page.url() : null;
}

/**
 * Adopt whatever site the page is actually on.
 *
 * The relay used to trust its --site flag and navigate to match, which meant
 * browsing to a different AI in the same tab silently kept the old site's
 * selectors — and could yank the tab away from where you were. Detection is
 * per-tick and follows the URL instead.
 *
 * @returns {Promise<{site: string|null, url: string|null, changed: boolean}>}
 */
export async function syncSiteFromUrl() {
  const url = await currentUrl();
  const detected = detectSiteFromUrl(url);
  const before = _meta.site;
  if (detected && detected !== before) _meta.site = detected;
  // On an unrecognised page keep whatever we had; GENERIC still drives it.
  return { site: _meta.site, url, changed: _meta.site !== before };
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
      pages.find((pg) => isKnownSiteUrl(pg.url())) ||
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
    };
    if (name === "firefox") {
      // No Chromium switches here. Firefox treats an unrecognised argument as a
      // URL, so passing --disable-blink-features=AutomationControlled made it
      // open a tab to "http://automationcontrolled/" on every launch.
      _context = await pw.firefox.launchPersistentContext(userDataDir, launchOpts);
    } else {
      launchOpts.args = ["--disable-blink-features=AutomationControlled"];
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
    // A site key with no URL may still be a bare hostname the caller typed.
    const cfg = allSites()[site];
    if (cfg?.url) {
      target = cfg.url;
      siteKey = site;
    } else if (site && /\./.test(site)) {
      target = site.includes("://") ? site : `https://${site}`;
      siteKey = detectSiteFromUrl(target) || "custom";
    } else {
      throw new Error(
        `Unknown site ${site}. Known: ${listSites().join(", ")} — or pass a URL.`
      );
    }
  } else {
    // Any URL is allowed. Recognise it when we can so the tuned selectors
    // apply; otherwise "custom" falls back to GENERIC, which still works.
    siteKey = detectSiteFromUrl(target) || site || "custom";
  }

  if (_meta.mode === "extension") {
    const includes = urlIncludesForSite(siteKey);
    let focused = null;
    try {
      focused = await ext.extFocusTab({ urlIncludes: includes });
    } catch {
      focused = null;
    }
    if (!focused || !includes || !urlHasHost(focused.url || "", includes)) {
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

  const site = siteConfig(_meta.site);
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

/**
 * Is the page currently streaming a reply?
 *
 * Returns true/false when we can tell, and null when we cannot (extension mode,
 * or a site with no stop-button selectors). Null means "unknown" and callers
 * must not read it as "finished" — that conflation is what let partial answers
 * through.
 */
export async function browserIsGenerating() {
  if (_meta.mode === "extension") return null;
  const site = siteConfig(_meta.site);
  const stopSelectors = site?.stopSelectors;
  if (!stopSelectors?.length) return null;

  const page = requirePage();
  try {
    return await page.evaluate((selectors) => {
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          if (el.offsetParent === null && style.position !== "fixed") continue;
          return true;
        }
      }
      return false;
    }, stopSelectors);
  } catch {
    return null;
  }
}

/**
 * Wait for an assistant turn that is actually finished.
 *
 * The old relay forwarded the first extraction whose text differed from the
 * previous turn. Mid-stream that difference is already true, so a partial reply
 * got posted as final — silently, since a half-written DOM node looks exactly
 * like a complete one.
 *
 * Completion here needs two independent things to agree:
 *   1. the text stopped growing for `idleMs` (quiescence), and
 *   2. the page is not reporting an active stream (when it can report at all).
 *
 * Quiescence alone is not enough — a pause between tokens looks identical to an
 * ending. The generating flag alone is not enough either, because it can flip
 * before the last frame paints. Requiring both, and treating unknown as
 * not-a-completion-signal, is what keeps partials out.
 *
 * @returns {Promise<{text: string, settled: boolean, reason: string} | null>}
 */
export function createTurnSettler({ prevText = null, idleMs = 1200 } = {}) {
  let candidate = null;
  let lastChangeAt = null;
  let sawGenerating = false;

  return {
    /**
     * Feed one observation. Returns a result once the turn looks complete,
     * otherwise null (keep polling).
     * @param {{text: string|null, generating: boolean|null, now: number}} obs
     */
    observe({ text, generating, now }) {
      if (generating === true) sawGenerating = true;

      if (text && text !== prevText && text !== candidate) {
        candidate = text;
        lastChangeAt = now;
      }
      if (!candidate) return null;

      // Unknown generating state (extension mode) leaves quiescence as the only
      // signal, so demand a longer quiet period before trusting it.
      const quiet = generating === null ? idleMs * 2 : idleMs;
      if (now - lastChangeAt < quiet) return null;
      if (generating === true) return null;

      return {
        text: candidate,
        settled: true,
        reason: generating === false ? "idle+not-generating" : "idle-only",
      };
    },

    /** Best available answer once time ran out. */
    give_up() {
      if (!candidate) return null;
      return {
        text: candidate,
        settled: false,
        reason: sawGenerating ? "timeout-mid-stream" : "timeout",
      };
    },
  };
}

export async function waitForAssistantTurn({
  prevText = null,
  timeoutMs = 120_000,
  idleMs = 1200,
  pollMs = 400,
} = {}) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  const settler = createTurnSettler({ prevText, idleMs });

  while (Date.now() < deadline) {
    const extracted = await browserExtractMessages({ limit: 50 });
    if (extracted.blocked) {
      const partial = settler.give_up();
      return partial ? { ...partial, reason: extracted.blocked } : null;
    }

    const done = settler.observe({
      text: extracted.lastAssistant?.text || null,
      generating: await browserIsGenerating(),
      now: Date.now(),
    });
    if (done) return done;

    await sleep(pollMs);
  }

  return settler.give_up();
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
  const site = siteConfig(_meta.site);
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
