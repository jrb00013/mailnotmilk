/**
 * Chrome / Firefox automation for web AI chats (ChatGPT, DeepSeek, …).
 * Prefer mailnotmilk Chrome extension (normal Chrome shortcut, any site).
 * Fallback: CDP / Playwright.
 */

import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, ensureDataDir } from "./paths.js";
import * as ext from "./ext-client.js";
import { latency } from "./latency.js";

let _pw = null;
let _browser = null;
let _context = null;
let _page = null;
let _cfRecovering = false;
let _cfHealAttempts = 0;
let _meta = {
  browser: null,
  site: null,
  cdp: false,
  mode: null,
  tabId: null,
  extensionStatus: null,
  extensionSeen: false,
  headless: false,
  headlessMode: null,
};

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
        ? Boolean(_meta.extensionSeen)
        : Boolean(_page),
    browser: _meta.browser,
    site: _meta.site,
    cdp: _meta.cdp,
    mode: _meta.mode,
    tabId: _meta.tabId,
    headless: Boolean(_meta.headless),
    headlessMode: _meta.headlessMode || null,
    cdpUrl: _meta.cdpUrl || null,
    primaryCookies: _meta.primaryCookies || null,
    extension: _meta.extensionStatus || {
      connected: false,
      lastHello: null,
    },
    url: _page ? _page.url() : null,
  };
}

/**
 * Pick a connect mode that can actually talk to ChatGPT.
 * Never claim "extension" when the extension is offline — that left agents
 * stuck with connected:false and no CDP fallback.
 */
export async function resolveBrowserConnectMode({
  mode = "auto",
  cdpUrl = "http://127.0.0.1:9222",
  // Test hooks — production callers leave these unset.
  extStatusFn = null,
  ensureChromeCdpFn = null,
} = {}) {
  if (mode && mode !== "auto") {
    return { mode, reason: "explicit" };
  }

  const statusFn = extStatusFn || (() => ext.extStatus());
  const extStatusNow = await statusFn().catch(() => ({
    connected: false,
    lastHello: null,
  }));
  if (extStatusNow.connected || extStatusNow.lastHello) {
    return { mode: "extension", reason: "extension-live", extension: extStatusNow };
  }

  const ensureFn =
    ensureChromeCdpFn ||
    (async (opts) => {
      const { ensureChromeCdp } = await import("./chrome-session.js");
      return ensureChromeCdp(opts);
    });
  // Prefer true headless=new CDP (system Chrome) unless MAILNOTMILK_HEADED=1.
  const preferHeadless = process.env.MAILNOTMILK_HEADED !== "1";
  const sess = await ensureFn({
    cdpUrl: preferHeadless
      ? cdpUrl.replace(/:9222\b/, ":9223") || "http://127.0.0.1:9223"
      : cdpUrl,
    startIfMissing: true,
    openUrl: process.env.MAILNOTMILK_START_URL || null,
    headless: preferHeadless,
  });
  if (sess.ok) {
    return {
      mode: "cdp",
      reason: sess.started
        ? preferHeadless
          ? "cdp-headless-started"
          : "cdp-started"
        : "cdp-existing",
      cdp: sess,
      headless: preferHeadless,
      headlessMode: sess.headlessMode || null,
    };
  }

  return {
    mode: "launch",
    reason: preferHeadless ? "playwright-headless-fallback" : "playwright-headed-fallback",
    cdpError: sess.error || null,
    headless: preferHeadless,
  };
}

function sameEndpoint(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.host === ub.host && ua.pathname === ub.pathname;
  } catch {
    return String(a) === String(b);
  }
}

export async function browserConnect({
  browser = "chrome",
  mode = "launch",
  cdpUrl = "http://127.0.0.1:9222",
  headless = process.env.MAILNOTMILK_HEADED !== "1",
  profileDir = null,
  force = false,
} = {}) {
  const lat = latency();
  // Reuse an existing live CDP/extension session — biggest round-trip win.
  if (
    !force &&
    lat.reuseCdpSession &&
    _meta.mode &&
    (mode === "auto" || mode === _meta.mode || (mode === "cdp" && _meta.mode === "cdp"))
  ) {
    if (_meta.mode === "extension" && _meta.extensionSeen) return browserStatus();
    if (_meta.mode === "cdp" && _page && _meta.cdpUrl) {
      const want = String(cdpUrl || _meta.cdpUrl);
      if (sameEndpoint(_meta.cdpUrl, want) || want.includes("9223") || want.includes("9222")) {
        return browserStatus();
      }
    }
  }

  await browserDisconnect();
  const name = browser === "firefox" ? "firefox" : "chromium";

  let resolvedMode = mode;
  if (mode === "auto") {
    const picked = await resolveBrowserConnectMode({ mode: "auto", cdpUrl });
    resolvedMode = picked.mode;
  }

  if (resolvedMode === "extension") {
    // The extension only ever talks to the hub, so ask the hub whether it is
    // there. Doing this at connect time is what makes `./run.sh` report the
    // truth instead of guessing from a local (always empty) copy of the state.
    const extStatusNow = await ext.extStatus();
    const live = Boolean(extStatusNow.connected || extStatusNow.lastHello);
    if (!live) {
      // Don't strand callers in a fake extension session — fall through to CDP.
      const picked = await resolveBrowserConnectMode({ mode: "auto", cdpUrl });
      if (picked.mode === "extension") {
        throw new Error(
          "mailnotmilk Chrome extension is not connected. Install/enable it, or use mode=cdp / mode=launch."
        );
      }
      return browserConnect({
        browser,
        mode: picked.mode,
        cdpUrl,
        headless,
        profileDir,
      });
    }
    _meta = {
      browser: "chrome-extension",
      site: null,
      cdp: false,
      mode: "extension",
      tabId: null,
      extensionStatus: extStatusNow,
      extensionSeen: true,
    };
    return browserStatus();
  }

  const pw = await loadPlaywright();
  _meta = {
    browser: name,
    site: null,
    cdp: resolvedMode === "cdp",
    mode: resolvedMode,
    tabId: null,
    extensionStatus: null,
    extensionSeen: false,
    headless: Boolean(headless),
  };

  if (resolvedMode === "cdp") {
    if (name !== "chromium") {
      throw new Error("CDP attach is Chromium/Chrome only; use mode=launch for Firefox");
    }
    const { ensureChromeCdp, resolveHeadlessMode } = await import("./chrome-session.js");
    const headlessMode = resolveHeadlessMode(headless);
    const sess = await ensureChromeCdp({
      cdpUrl,
      startIfMissing: true,
      openUrl: process.env.MAILNOTMILK_START_URL || null,
      headless: headless === false ? false : headless === true ? true : headless,
      forceRestart: false,
    });
    if (!sess.ok) {
      throw new Error(
        `CDP not available (${sess.error || "unknown"}). Install Google Chrome.`
      );
    }
    const attachUrl = sess.cdpUrl || cdpUrl;
    _browser = await pw.chromium.connectOverCDP(attachUrl);
    const contexts = _browser.contexts();
    _context = contexts[0] || (await _browser.newContext());
    const { applyStealthToContext } = await import("./stealth.js");
    await applyStealthToContext(_context);
    // Pull live session cookies from Firefox/Chrome for known page targets only
    // (avoid dumping the entire jar when we don't know the site yet).
    if (process.env.MAILNOTMILK_IMPORT_PRIMARY !== "0") {
      try {
        const {
          extractPrimaryCookies,
          injectCookiesIntoContext,
        } = await import("./primary-browser.js");
        const targets = [
          process.env.MAILNOTMILK_START_URL,
          ...(_context.pages() || []).map((p) => p.url()).filter((u) => /^https?:/i.test(u)),
        ].filter(Boolean);
        if (targets.length) {
          const jar = extractPrimaryCookies({ targets });
          if (jar.ok && jar.cookies?.length) {
            const inj = await injectCookiesIntoContext(_context, jar.cookies);
            _meta.primaryCookies = {
              browser: jar.browser,
              injected: inj.injected,
              score: jar.score,
              profileDir: jar.profileDir,
            };
            console.error(
              `browser: injected ${inj.injected} cookies from primary ${jar.browser} (${jar.profileDir})`
            );
          } else {
            _meta.primaryCookies = {
              ok: false,
              error: jar.error,
              candidates: jar.candidates,
            };
          }
        }
      } catch (err) {
        console.error(`browser: primary cookie inject error: ${err.message}`);
      }
    }
    const pages = _context.pages();
    _page =
      pages.find((pg) => isKnownSiteUrl(pg.url())) ||
      pages.find((pg) => /^https?:/i.test(pg.url())) ||
      null;
    if (!_page) _page = await _context.newPage();
    _meta.headless = headlessMode !== "headed";
    _meta.headlessMode = sess.headlessMode || headlessMode;
    _meta.browser = "chrome";
    _meta.cdpUrl = attachUrl;
  } else {
    ensureDataDir();
    const userDataDir =
      profileDir || join(dataDir(), "browser-profiles", name);
    mkdirSync(userDataDir, { recursive: true });
    const launchHeadless = Boolean(headless);
    const launchOpts = {
      headless: launchHeadless,
      viewport: { width: 1400, height: 900 },
    };
    if (name === "firefox") {
      // No Chromium switches here. Firefox treats an unrecognised argument as a
      // URL, so passing --disable-blink-features=AutomationControlled made it
      // open a tab to "http://automationcontrolled/" on every launch.
      // Mozilla headless is first-class: `firefox --headless` / Playwright headless.
      _context = await pw.firefox.launchPersistentContext(userDataDir, launchOpts);
    } else {
      launchOpts.args = ["--disable-blink-features=AutomationControlled"];
      // System Chrome channel — uses Chromium's headless=new when headless:true
      try {
        _context = await pw.chromium.launchPersistentContext(userDataDir, {
          ...launchOpts,
          channel: "chrome",
        });
        _meta.browser = "chrome";
      } catch (err) {
        try {
          _context = await pw.chromium.launchPersistentContext(userDataDir, launchOpts);
        } catch (err2) {
          throw new Error(
            `Could not launch browser (${err2.message || err.message}). Install Google Chrome or: npx playwright install chromium`
          );
        }
      }
    }
    const { applyStealthToContext } = await import("./stealth.js");
    await applyStealthToContext(_context);
    _browser = _context.browser();
    _page = _context.pages()[0] || (await _context.newPage());
  }

  return browserStatus();
}

function shouldAttemptCfRecovery() {
  if (_cfRecovering) return false;
  if (_cfHealAttempts >= 2) return false;
  // Already on invisible Xvfb warm — don't loop.
  if (_meta.headlessMode === "offscreen") return false;
  if (_meta.headlessMode === "headed") return false;
  return Boolean(_meta.headless) || _meta.mode === "launch" || _meta.headlessMode === "new";
}

async function attachChatgptPage(openUrl) {
  if (!_context) return null;
  let page =
    _context.pages().find((pg) => isKnownSiteUrl(pg.url())) ||
    _context.pages().find((pg) => /^https?:/i.test(pg.url())) ||
    null;
  if (!page) page = await _context.newPage();
  if (!isKnownSiteUrl(page.url())) {
    await page.goto(openUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  }
  _page = page;
  return page;
}

/**
 * Automated CF heal — never pops a window on the user desktop:
 * 1) Xvfb warm → `--headless=new`
 * 2) If CF still blocks, stay on Xvfb headed (invisible) and continue
 */
export async function recoverBrowserForCloudflare({
  cdpUrl = "http://127.0.0.1:9223",
  site = null,
} = {}) {
  if (_cfRecovering) {
    return {
      ok: false,
      error: "CF auto-heal already running",
      wasHeadless: Boolean(_meta.headless),
    };
  }
  _cfRecovering = true;
  _cfHealAttempts += 1;
  const wasHeadless = Boolean(_meta.headless) || _meta.mode === "launch";
  try {
    const openUrl =
      (site && allSites()[site]?.url) ||
      _page?.url?.() ||
      process.env.MAILNOTMILK_START_URL ||
      "about:blank";
    const recoverUrl = String(cdpUrl || _meta.cdpUrl || "http://127.0.0.1:9223").replace(
      /:9222\b/,
      ":9223"
    );

    await browserDisconnect();
    const { ensureTrueHeadlessCdp, ensureChromeCdp } = await import("./chrome-session.js");

    const sess = await ensureTrueHeadlessCdp({
      cdpUrl: recoverUrl,
      openUrl,
      waitCfMs: 60_000,
      checkCfFn: async ({ cdpUrl: warmUrl, timeoutMs }) => {
        const pw = await loadPlaywright();
        let browser = null;
        try {
          browser = await pw.chromium.connectOverCDP(warmUrl);
          const ctx = browser.contexts()[0] || (await browser.newContext());
          let page =
            ctx.pages().find((pg) => isKnownSiteUrl(pg.url())) ||
            ctx.pages().find((pg) => /^https?:/i.test(pg.url())) ||
            (await ctx.newPage());
          if (!isKnownSiteUrl(page.url())) {
            await page.goto(openUrl, {
              waitUntil: "domcontentloaded",
              timeout: 60_000,
            });
          }
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const title = await page.title().catch(() => "");
            const body = await page
              .evaluate(() => (document.body?.innerText || "").slice(0, 800))
              .catch(() => "");
            const blocked =
              /just a moment|verify you are human|attention required|cf-challenge/i.test(
                `${title} ${body}`
              );
            if (!blocked) return { ok: true, waitedMs: Date.now() - start };
            await sleep(1500);
          }
          return { ok: false, error: "warm CF timeout" };
        } catch (err) {
          return { ok: false, error: err.message };
        } finally {
          try {
            await browser?.close();
          } catch {
            /* ignore */
          }
        }
      },
    });

    if (!sess.ok) {
      return {
        ok: false,
        error: sess.error || "automated headless CF heal failed",
        stage: sess.stage,
        wasHeadless,
      };
    }

    let status = await browserConnect({
      browser: "chrome",
      mode: "cdp",
      cdpUrl: sess.cdpUrl || recoverUrl,
      headless: "new",
    });
    const lat = latency();
    await attachChatgptPage(openUrl);
    _meta.site = site || detectSiteFromUrl(openUrl) || _meta.site;
    if (lat.postNavSettleMs) await sleep(lat.postNavSettleMs);

    let stillCf = await isCloudflareChallenge().catch(() => true);
    if (stillCf) {
      // Stay invisible on Xvfb — never ask a human to click, never use user DISPLAY.
      console.error(
        "browser: CF/auto — --headless=new still challenged; staying on Xvfb (your screen stays empty)"
      );
      await browserDisconnect();
      const warm = await ensureChromeCdp({
        cdpUrl: recoverUrl,
        startIfMissing: true,
        openUrl,
        headless: "offscreen",
        forceRestart: true,
      });
      if (!warm.ok) {
        return { ok: false, error: warm.error || "xvfb stay failed", wasHeadless };
      }
      status = await browserConnect({
        browser: "chrome",
        mode: "cdp",
        cdpUrl: warm.cdpUrl || recoverUrl,
        headless: "offscreen",
        force: true,
      });
      await attachChatgptPage(openUrl);
      _meta.site = site || detectSiteFromUrl(openUrl) || _meta.site;
      if (lat.postNavSettleMs) await sleep(lat.postNavSettleMs);
      stillCf = await isCloudflareChallenge().catch(() => true);
    }

    return {
      ok: !stillCf,
      status,
      cloudflare: { ok: !stillCf, challenge: stillCf },
      recovered: true,
      headlessMode: _meta.headlessMode,
      automated: true,
      wasHeadless,
    };
  } finally {
    _cfRecovering = false;
  }
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
  _meta = {
    browser: null,
    site: null,
    cdp: false,
    mode: null,
    tabId: null,
    extensionStatus: null,
    extensionSeen: false,
  };
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
export async function waitForCloudflareClear({ timeoutMs = null } = {}) {
  const lat = latency();
  const budget = timeoutMs == null ? lat.cfDefaultTimeoutMs : timeoutMs;
  if (_meta.mode === "extension") {
    const start = Date.now();
    let challenge = await isCloudflareChallenge();
    if (!challenge) return { ok: true, waitedMs: 0, challenge: false };
    console.error(
      "browser: Cloudflare challenge in extension tab — waiting for auto-clear / prior login cookies."
    );
    while (Date.now() - start < budget) {
      await sleep(lat.cfPollMs);
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
    _meta.headless || _meta.headlessMode === "offscreen" || _meta.headlessMode === "new"
      ? "browser: Cloudflare challenge — waiting for automated clear (no desktop window)."
      : "browser: Cloudflare challenge detected — waiting for clear."
  );
  while (Date.now() - start < budget) {
    await sleep(lat.cfPollMs);
    challenge = await isCloudflareChallenge();
    if (!challenge) {
      if (lat.cfClearExtraMs) await sleep(lat.cfClearExtraMs);
      console.error("browser: Cloudflare cleared");
      return { ok: true, waitedMs: Date.now() - start, challenge: true };
    }
    // Cheap readiness probe every other poll
    if (((Date.now() - start) / lat.cfPollMs) % 2 < 1) {
      const hasComposer = await page
        .locator('#prompt-textarea, div[contenteditable="true"], textarea')
        .first()
        .count()
        .catch(() => 0);
      if (hasComposer > 0 && !(await isCloudflareChallenge())) {
        return { ok: true, waitedMs: Date.now() - start, challenge: true };
      }
    }
  }
  return { ok: false, waitedMs: Date.now() - start, challenge: true };
}

/** Wait until composer is present or budget exhausted — replaces fixed sleeps. */
async function waitForComposer(page, selectors, { retries = null, retryMs = null } = {}) {
  const lat = latency();
  const n = retries == null ? lat.composerRetries : retries;
  const gap = retryMs == null ? lat.composerRetryMs : retryMs;
  for (let i = 0; i < n; i++) {
    const found = await firstSelector(page, selectors);
    if (found) return found;
    await sleep(gap);
  }
  return null;
}

function urlsMatch(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const norm = (u) =>
      `${u.origin}${u.pathname.replace(/\/$/, "")}${u.search}`;
    return norm(ua) === norm(ub);
  } catch {
    return String(a) === String(b);
  }
}

export async function browserOpenAi({ site = null, url = null } = {}) {
  let target = url;
  let siteKey = site;
  if (!target) {
    // A site key with no URL may still be a bare hostname the caller typed.
    const cfg = site ? allSites()[site] : null;
    if (cfg?.url) {
      target = cfg.url;
      siteKey = site;
    } else if (site && /\./.test(site)) {
      target = site.includes("://") ? site : `https://${site}`;
      siteKey = detectSiteFromUrl(target) || "custom";
    } else {
      throw new Error(
        `Pass site= (known: ${listSites().join(", ")}) or url= (any https chat). No default vendor URL.`
      );
    }
  } else {
    // Any URL is allowed. Recognise it when we can so the tuned selectors
    // apply; otherwise "custom" falls back to GENERIC, which still works.
    siteKey = detectSiteFromUrl(target) || site || "custom";
  }

  // Re-inject primary cookies only when target host changed (cache hit skips work).
  if (
    _context &&
    _meta.mode !== "extension" &&
    process.env.MAILNOTMILK_IMPORT_PRIMARY !== "0"
  ) {
    const prevTarget = _meta.primaryCookies?.target || "";
    let prevHost = "";
    let nextHost = "";
    try {
      prevHost = new URL(prevTarget).hostname;
      nextHost = new URL(target).hostname;
    } catch {
      nextHost = target;
    }
    if (prevHost !== nextHost) {
      try {
        const {
          extractPrimaryCookies,
          injectCookiesIntoContext,
        } = await import("./primary-browser.js");
        const jar = extractPrimaryCookies({ targets: [target] });
        if (jar.ok && jar.cookies?.length) {
          const inj = await injectCookiesIntoContext(_context, jar.cookies);
          _meta.primaryCookies = {
            browser: jar.browser,
            injected: inj.injected,
            score: jar.score,
            profileDir: jar.profileDir,
            target,
            cached: Boolean(jar.cached),
          };
          console.error(
            `browser: refreshed ${inj.injected} primary ${jar.browser} cookies for ${target}${jar.cached ? " (cached)" : ""}`
          );
        }
      } catch (err) {
        console.error(`browser: cookie refresh error: ${err.message}`);
      }
    }
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
    const cf = await waitForCloudflareClear();
    return {
      ...browserStatus(),
      title: focused.title || null,
      url: focused.url || target,
      cloudflare: cf,
    };
  }

  const page = requirePage();
  const lat = latency();
  const alreadyThere = urlsMatch(page.url(), target);
  if (!alreadyThere) {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  _meta.site = siteKey;

  // Fast path: if composer is already up, skip long CF waits.
  const siteCfg = siteConfig(siteKey);
  const composers = siteCfg?.composerSelectors || [
    "textarea",
    'div[contenteditable="true"]',
  ];
  const ready = await waitForComposer(page, composers, {
    retries: alreadyThere ? 2 : Math.min(6, lat.composerRetries),
  });
  if (!ready && (await isCloudflareChallenge())) {
    if (shouldAttemptCfRecovery()) {
      const recovery = await recoverBrowserForCloudflare({ site: siteKey });
      return {
        ...browserStatus(),
        title: _page ? await _page.title().catch(() => null) : null,
        cloudflare: recovery.cloudflare || { ok: recovery.ok },
        recovered: Boolean(recovery.recovered),
        headlessMode: _meta.headlessMode,
      };
    }
    const cf = await waitForCloudflareClear();
    if (!cf.ok) {
      console.error(
        "browser: still on Cloudflare after timeout — messages will not extract until you pass the check"
      );
    }
    return { ...browserStatus(), title: await page.title(), cloudflare: cf };
  }

  if (!ready && lat.postNavSettleMs) await sleep(lat.postNavSettleMs);
  return {
    ...browserStatus(),
    title: await page.title(),
    cloudflare: { ok: true, waitedMs: 0, challenge: false, skipped: Boolean(ready) },
  };
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
    if (shouldAttemptCfRecovery()) {
      const recovery = await recoverBrowserForCloudflare({ site: _meta.site });
      if (recovery.ok && !(await isCloudflareChallenge())) {
        return browserExtractMessages({ limit });
      }
    }
    return {
      site: _meta.site,
      url: page.url(),
      count: 0,
      messages: [],
      lastAssistant: null,
      lastUser: null,
      blocked: "cloudflare",
      error:
        "Cloudflare challenge is showing. Default is Chrome --headless=new; auto-recovery uses offscreen headed CDP. If a Verify prompt remains, set MAILNOTMILK_HEADED=1 once to clear it.",
    };
  }

  const site = siteConfig(_meta.site);
  const selectors = site?.messageSelectors || [
    "[data-message-author-role]",
    ".ds-message",
    "article",
    "[class*='message']",
  ];

  // Single evaluate pass — role nodes first, then "You said:" transcript parse.
  const messages = await page.evaluate(
    ({ selectors, roleAttr, limit }) => {
      const out = [];
      const seen = new Set();
      const push = (role, text) => {
        const t = (text || "").trim();
        if (!t || t.length < 2) return;
        if (/^(latest response|loading chats|think)$/i.test(t)) return;
        const key = `${role}:${t.slice(0, 160)}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ role, text: t.slice(0, 12000) });
      };

      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
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
            else continue;
          }
          const body =
            el.querySelector?.(".markdown, .prose, [class*='markdown']") || el;
          push(role, body.innerText || body.textContent || "");
        }
        if (out.length) break;
      }

      if (!out.length) {
        for (const el of document.querySelectorAll("[data-message-author-role]")) {
          push(
            el.getAttribute("data-message-author-role") || "unknown",
            el.innerText || el.textContent || ""
          );
        }
      }

      // Transcript labels used by several web UIs (multi-line turns).
      if (!out.length) {
        const root = document.querySelector("main") || document.body;
        const raw = (root?.innerText || "").replace(/\r/g, "");
        const parts = raw.split(/\n(?=You said:|ChatGPT said:|Assistant:|User:)/i);
        for (const part of parts) {
          const t = part.trim();
          if (!t) continue;
          if (/^You said:/i.test(t)) push("user", t.replace(/^You said:\s*/i, ""));
          else if (/^(ChatGPT said:|Assistant:)/i.test(t))
            push("assistant", t.replace(/^(ChatGPT said:|Assistant:)\s*/i, ""));
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
  timeoutMs = null,
  idleMs = null,
  pollMs = null,
} = {}) {
  const lat = latency();
  const budget = timeoutMs == null ? lat.assistantTimeoutMs : timeoutMs;
  const idle = idleMs == null ? lat.assistantIdleMs : idleMs;
  const poll = pollMs == null ? lat.assistantPollMs : pollMs;
  const deadline = Date.now() + Math.max(0, Number(budget) || 0);
  const settler = createTurnSettler({ prevText, idleMs: idle });

  while (Date.now() < deadline) {
    const [extracted, generating] = await Promise.all([
      browserExtractMessages({ limit: 30 }),
      browserIsGenerating(),
    ]);
    if (extracted.blocked) {
      const partial = settler.give_up();
      return partial ? { ...partial, reason: extracted.blocked } : null;
    }

    const done = settler.observe({
      text: extracted.lastAssistant?.text || null,
      generating,
      now: Date.now(),
    });
    if (done) return done;

    await sleep(poll);
  }

  return settler.give_up();
}

/**
 * Send + wait for the next assistant turn (optimized defaults).
 */
export async function browserRoundTrip({
  text,
  submit = true,
  timeoutMs = null,
} = {}) {
  const before = await browserExtractMessages({ limit: 5 });
  const prev = before.lastAssistant?.text || null;
  const sent = await browserSendMessage({ text, submit });
  const turn = await waitForAssistantTurn({
    prevText: prev,
    timeoutMs,
  });
  return {
    ok: Boolean(turn?.text),
    sent,
    assistant: turn?.text || null,
    settled: Boolean(turn?.settled),
    reason: turn?.reason || null,
    url: browserStatus().url,
    site: _meta.site,
    ms: undefined,
  };
}

async function ensureNotCloudflareOrRecover(action = "continue") {
  if (!(await isCloudflareChallenge())) return { recovered: false };

  // --headless=new / Playwright launch often fails CF — bounce to offscreen headed.
  if (_meta.mode !== "extension" && shouldAttemptCfRecovery()) {
    const recovery = await recoverBrowserForCloudflare({ site: _meta.site });
    if (recovery.ok && !(await isCloudflareChallenge())) {
      return { recovered: true, recovery };
    }
  }

  const cf = await waitForCloudflareClear({ timeoutMs: 120_000 });
  if (cf.ok) return { recovered: false, waited: cf };

  throw new Error(
    `Cloudflare challenge is blocking ${action}. A headed Chrome CDP window should be open — click “Verify you are human”, then retry. Steady-state default is Chrome --headless=new via CDP.`
  );
}

export async function browserSendMessage({ text, submit = true } = {}) {
  if (!text) throw new Error("text required");
  if (_meta.mode === "extension") {
    await ensureNotCloudflareOrRecover("send");
    const data = await ext.extSend({ text, tabId: _meta.tabId, submit });
    if (data?.tabId) _meta.tabId = data.tabId;
    return { ok: true, site: _meta.site, ...data };
  }
  await ensureNotCloudflareOrRecover("send");
  const page = requirePage();
  const lat = latency();
  const site = siteConfig(_meta.site);
  const composers = site?.composerSelectors || [
    "textarea",
    'div[contenteditable="true"]',
  ];
  const composer = await waitForComposer(page, composers);
  if (!composer) {
    throw new Error(
      "Could not find chat composer on page (login wall or still loading). If you see Log in, use your normal Chrome profile via the mailnotmilk extension, or log in once in the CDP Chrome window (~/.mailnotmilk/chrome-cdp)."
    );
  }

  await composer.click({ timeout: 5_000 });
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
      await sendBtn.click({ timeout: 3000 }).catch(async () => {
        await page.keyboard.press("Enter");
      });
    } else {
      await page.keyboard.press("Enter");
    }
    if (lat.postSendMs) await sleep(lat.postSendMs);
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

/**
 * Inventory chats / history visible in the current browser AI sidebar.
 * Site-agnostic — scrapes nav/aside links; works for ChatGPT, Claude, etc.
 */
export async function browserListChats({ limit = 50 } = {}) {
  if (_meta.mode === "extension") {
    try {
      const data = await ext.extEval({
        tabId: _meta.tabId,
        code: `(() => {
          const chats = [];
          const seen = new Set();
          for (const a of document.querySelectorAll('a[href], [role="listitem"] a, nav a, aside a')) {
            const href = a.href || a.getAttribute('href') || '';
            const text = (a.innerText || a.textContent || '').trim().replace(/\\s+/g, ' ');
            if (!text || text.length < 2) continue;
            const key = href + '|' + text.slice(0, 80);
            if (seen.has(key)) continue;
            seen.add(key);
            if (/\\/(c|chat|g|project)\\//i.test(href) || /history|conversation/i.test(a.className || '')) {
              chats.push({ title: text.slice(0, 160), href: href.slice(0, 300) });
            }
          }
          const body = (document.body && document.body.innerText || '').slice(0, 500);
          return {
            chats: chats.slice(0, ${Math.min(Math.max(Number(limit) || 50, 1), 100)}),
            loggedIn: !/sign up for free/i.test(body) && !/^\\s*log in\\b/im.test(body.slice(0, 200)),
            url: location.href,
          };
        })()`,
      });
      return { site: _meta.site, ...(data || { chats: [] }) };
    } catch (err) {
      return { site: _meta.site, chats: [], error: err.message };
    }
  }

  const page = requirePage();
  const max = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const data = await page.evaluate((maxN) => {
    const chats = [];
    const seen = new Set();
    const push = (title, href) => {
      const t = (title || "").trim().replace(/\s+/g, " ");
      if (!t || t.length < 2) return;
      const key = `${href}|${t.slice(0, 80)}`;
      if (seen.has(key)) return;
      seen.add(key);
      chats.push({ title: t.slice(0, 160), href: (href || "").slice(0, 300) });
    };

    for (const a of document.querySelectorAll(
      'a[href*="/c/"], a[href*="/chat/"], a[href*="/g/"], a[href*="conversation"], nav a, aside a, [data-testid*="history"] a'
    )) {
      const href = a.href || "";
      if (/\/(c|chat|g|project)\//i.test(href) || /history|conversation/i.test(a.getAttribute("data-testid") || "")) {
        push(a.innerText || a.textContent, href);
      }
    }

    // Claude / Gemini often use buttons or divs in a history rail
    for (const el of document.querySelectorAll(
      '[data-testid="history-item"], [class*="conversation"], [class*="History"] a, [class*="history"] a'
    )) {
      const a = el.tagName === "A" ? el : el.querySelector?.("a") || el;
      push(a.innerText || a.textContent, a.href || "");
    }

    const body = (document.body?.innerText || "").slice(0, 800);
    const guest =
      /sign up for free/i.test(body) ||
      (/^\s*log in\b/im.test(body.slice(0, 300)) && /sign up/i.test(body));
    return {
      chats: chats.slice(0, maxN),
      count: Math.min(chats.length, maxN),
      loggedIn: !guest,
      guest,
      url: location.href,
      title: document.title,
    };
  }, max);

  return { site: _meta.site, ...data };
}

export { SITES };
