/**
 * Attach to Chrome via CDP — including true headless via Chromium's
 * `--headless=new` (the modern headless that shares the real browser stack
 * with headed Chrome, unlike legacy Playwright headless).
 *
 * Dedicated profile under ~/.mailnotmilk/chrome-cdp so we never fight the
 * user's daily Chrome profile lock.
 */

import { spawn, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import http from "node:http";

function probe(url, timeoutMs = 400) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode > 0 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function cdpUp(cdpUrl = "http://127.0.0.1:9222") {
  return probe(`${cdpUrl.replace(/\/$/, "")}/json/version`);
}

export function findChromeBin() {
  const env = process.env.MAILNOTMILK_CHROME || process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;

  const candidates =
    platform() === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : platform() === "win32"
        ? [
            `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
          ];

  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }

  try {
    const which = platform() === "win32" ? "where" : "command -v";
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
      try {
        const out = execSync(`${which} ${name}`, { encoding: "utf8" }).trim().split("\n")[0];
        if (out && existsSync(out)) return out;
      } catch {
        /* continue */
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function findFirefoxBin() {
  const env = process.env.MAILNOTMILK_FIREFOX || process.env.FIREFOX_PATH;
  if (env && existsSync(env)) return env;
  const candidates =
    platform() === "darwin"
      ? ["/Applications/Firefox.app/Contents/MacOS/firefox"]
      : platform() === "win32"
        ? [
            `${process.env.PROGRAMFILES}\\Mozilla Firefox\\firefox.exe`,
            `${process.env["PROGRAMFILES(X86)"]}\\Mozilla Firefox\\firefox.exe`,
          ]
        : ["/usr/bin/firefox", "/usr/bin/firefox-esr", "/snap/bin/firefox"];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  try {
    const out = execSync("command -v firefox", { encoding: "utf8" }).trim();
    if (out && existsSync(out)) return out;
  } catch {
    /* ignore */
  }
  return null;
}

function cdpProfileDir(headless = false) {
  const dir = join(
    homedir(),
    ".mailnotmilk",
    headless ? "chrome-cdp-headless" : "chrome-cdp"
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Seed the headless profile from a warm headed CDP profile (cookies / local
 * storage). Cold headless=new still trips Cloudflare; a profile that already
 * passed CF in headed mode usually survives headless=new.
 */
export function seedHeadlessProfileFromHeaded({ force = false } = {}) {
  const headed = cdpProfileDir(false);
  const headless = cdpProfileDir(true);
  const headedDefault = join(headed, "Default");
  const headlessDefault = join(headless, "Default");
  if (!existsSync(headedDefault)) {
    return { ok: false, reason: "no-headed-profile" };
  }
  const headedCookies = join(headedDefault, "Cookies");
  if (!existsSync(headedCookies)) {
    return { ok: false, reason: "no-headed-cookies" };
  }
  const headlessCookies = join(headlessDefault, "Cookies");
  if (!force && existsSync(headlessCookies)) {
    try {
      if (statSync(headlessCookies).size > 0) {
        return { ok: true, reason: "already-seeded", headless };
      }
    } catch {
      /* copy */
    }
  }
  // Drop stale singleton locks so Chrome can open the copied profile.
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      rmSync(join(headless, name), { force: true });
    } catch {
      /* ignore */
    }
  }
  mkdirSync(headlessDefault, { recursive: true });
  const copyNames = [
    "Cookies",
    "Cookies-journal",
    "Login Data",
    "Login Data-journal",
    "Web Data",
    "Web Data-journal",
    "Local Storage",
    "Session Storage",
    "IndexedDB",
    "Network",
    "Preferences",
    "Secure Preferences",
  ];
  const copied = [];
  for (const name of copyNames) {
    const src = join(headedDefault, name);
    if (!existsSync(src)) continue;
    try {
      cpSync(src, join(headlessDefault, name), { recursive: true, force: true });
      copied.push(name);
    } catch {
      /* best-effort */
    }
  }
  // Local State (profile-level) helps CF trust continuity.
  const localState = join(headed, "Local State");
  if (existsSync(localState)) {
    try {
      cpSync(localState, join(headless, "Local State"), { force: true });
      copied.push("Local State");
    } catch {
      /* ignore */
    }
  }
  return { ok: copied.length > 0, reason: "seeded", copied, headless, headed };
}

function parsePort(cdpUrl, fallback = 9222) {
  try {
    const u = new URL(cdpUrl);
    return Number(u.port) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Resolve how "headless" should launch:
 * - `new`      → Chromium `--headless=new` (true headless; may trip CF cold)
 * - `offscreen`→ real headed Chrome parked off-screen (passes CF; no visible UI)
 *
 * Default: `offscreen` (real Chrome, window parked off-screen — survives CF).
 * Set MAILNOTMILK_HEADLESS_MODE=new for Chromium `--headless=new`.
 */
export function resolveHeadlessMode(headless) {
  if (headless === false || headless === "headed") return "headed";
  if (headless === "offscreen") return "offscreen";
  if (headless === "new") return "new";
  if (!headless) return "headed";
  const env = (process.env.MAILNOTMILK_HEADLESS_MODE || "offscreen").toLowerCase();
  if (env === "new" || env === "headless=new" || env === "headless-new") return "new";
  return "offscreen";
}

/**
 * Ensure a CDP endpoint is reachable.
 * headless=true → `--headless=new` by default (or offscreen headed via env).
 */
export async function ensureChromeCdp({
  cdpUrl = null,
  port = null,
  startIfMissing = true,
  openUrl = "https://chatgpt.com/",
  headless = false,
  forceRestart = false,
} = {}) {
  const mode = resolveHeadlessMode(headless);
  const wantsIsolated = mode === "new" || mode === "offscreen";
  // Isolated headless / offscreen use :9223 + chrome-cdp-headless profile.
  const defaultPort = wantsIsolated ? 9223 : 9222;
  let listenPort = port;
  if (listenPort == null) {
    const parsed = cdpUrl ? parsePort(cdpUrl, defaultPort) : defaultPort;
    listenPort = wantsIsolated && parsed === 9222 ? 9223 : parsed;
  }
  const base = cdpUrl && cdpUrl.includes("://") ? cdpUrl : `http://127.0.0.1:${listenPort}`;
  const url = base.replace(/:\d+/, `:${listenPort}`);

  if (!forceRestart && (await cdpUp(url))) {
    return {
      ok: true,
      cdpUrl: url,
      started: false,
      bin: null,
      headless: wantsIsolated,
      headlessMode: mode,
    };
  }
  if (!startIfMissing) {
    return { ok: false, cdpUrl: url, started: false, bin: null, error: "CDP not available" };
  }

  const bin = findChromeBin();
  if (!bin) {
    return { ok: false, cdpUrl: url, started: false, bin: null, error: "Chrome/Chromium binary not found" };
  }

  let seeded = null;
  if (wantsIsolated) {
    seeded = seedHeadlessProfileFromHeaded({ force: false });
  }
  // Offscreen uses the warm headed profile when available — CF clearance sticks.
  // --headless=new keeps its own profile (seeded) so it never locks the headed one.
  const useHeadedProfile = mode === "offscreen" && existsSync(join(cdpProfileDir(false), "Default"));
  const profile = useHeadedProfile ? cdpProfileDir(false) : cdpProfileDir(wantsIsolated);
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      rmSync(join(profile, name), { force: true });
    } catch {
      /* ignore */
    }
  }
  const args = [
    `--remote-debugging-port=${listenPort}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1400,900",
    "--lang=en-US",
  ];

  if (mode === "new") {
    // Chromium's new headless shares the headed codepath (Mozilla/Chrome both
    // moved away from the old stripped headless that automation detectors flag).
    args.push(
      "--headless=new",
      "--disable-gpu",
      "--ozone-override-screen-size=1400,900"
    );
  } else if (mode === "offscreen") {
    // Real headed binary, no visible window — survives Cloudflare better than
    // --headless=new on cold chatgpt.com sessions.
    args.push("--window-position=-2400,-2400", "--start-minimized");
  }

  if (openUrl) args.push(openUrl);

  console.error(
    `browser: starting ${bin} CDP :${listenPort} (${mode}, profile ${profile})`
  );
  const child = spawn(bin, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await cdpUp(url)) {
      return {
        ok: true,
        cdpUrl: url,
        started: true,
        bin,
        profile,
        headless: wantsIsolated,
        headlessMode: mode,
        seeded,
        pid: child.pid,
      };
    }
  }
  return {
    ok: false,
    cdpUrl: url,
    started: true,
    bin,
    profile,
    headless: wantsIsolated,
    headlessMode: mode,
    seeded,
    error: "Chrome started but CDP did not come up",
  };
}
