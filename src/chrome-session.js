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
import { latency } from "./latency.js";

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
 * - `new`      → Chromium `--headless=new` (true headless — default)
 * - `offscreen`→ real headed Chrome parked off-screen (CF warm helper only)
 *
 * Default: `new`. Set MAILNOTMILK_HEADLESS_MODE=offscreen to stay offscreen.
 */
export function resolveHeadlessMode(headless) {
  if (headless === false || headless === "headed") return "headed";
  if (headless === "offscreen") return "offscreen";
  if (headless === "new") return "new";
  if (!headless) return "headed";
  const env = (process.env.MAILNOTMILK_HEADLESS_MODE || "new").toLowerCase();
  if (env === "offscreen" || env === "headed-offscreen") return "offscreen";
  return "new";
}

/** Kill Chrome CDP listeners on a port (and matching user-data-dir processes). */
export async function stopCdpChrome({ port = 9223, profile = null } = {}) {
  try {
    execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
  } catch {
    /* nothing listening */
  }
  if (profile) {
    try {
      execSync(`pkill -f ${JSON.stringify(`--user-data-dir=${profile}`)}`, {
        stdio: "ignore",
      });
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, latency().cdpStopWaitMs));
  return { ok: true };
}

const XVFB_DISPLAY = process.env.MAILNOTMILK_XVFB_DISPLAY || ":97";
let _xvfbProc = null;

/**
 * Private Xvfb — headed Chrome can warm CF here without ever touching the
 * user's real DISPLAY (no popup on your desktop).
 */
export async function ensureVirtualDisplay() {
  if (process.env.MAILNOTMILK_NO_XVFB === "1") {
    return { ok: false, error: "MAILNOTMILK_NO_XVFB=1" };
  }
  try {
    execSync(`xdpyinfo -display ${XVFB_DISPLAY}`, { stdio: "ignore" });
    return { ok: true, display: XVFB_DISPLAY, started: false };
  } catch {
    /* need start */
  }
  const xvfb = execSync("command -v Xvfb || true", { encoding: "utf8" }).trim();
  if (!xvfb) {
    return { ok: false, error: "Xvfb not installed (apt install xvfb)" };
  }
  console.error(`browser: starting Xvfb ${XVFB_DISPLAY} (invisible warm display)`);
  _xvfbProc = spawn(
    xvfb,
    [XVFB_DISPLAY, "-screen", "0", "1400x900x24", "-ac", "-nolisten", "tcp"],
    { detached: true, stdio: "ignore" }
  );
  _xvfbProc.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      execSync(`xdpyinfo -display ${XVFB_DISPLAY}`, { stdio: "ignore" });
      return { ok: true, display: XVFB_DISPLAY, started: true, pid: _xvfbProc.pid };
    } catch {
      /* wait */
    }
  }
  return { ok: false, error: "Xvfb failed to start", display: XVFB_DISPLAY };
}

/**
 * Automated CF pipeline — never pops a window on the user desktop:
 * 1) Headed Chrome on private Xvfb display (invisible) until CF clears
 * 2) Seed cookies into headless profile
 * 3) Relaunch with true `--headless=new`
 */
export async function ensureTrueHeadlessCdp({
  cdpUrl = "http://127.0.0.1:9223",
  openUrl = null,
  waitCfMs = 90_000,
  checkCfFn = null,
} = {}) {
  openUrl = openUrl || process.env.MAILNOTMILK_START_URL || "about:blank";
  const listenPort = parsePort(cdpUrl, 9223);
  const url = `http://127.0.0.1:${listenPort}`;

  await stopCdpChrome({ port: listenPort, profile: cdpProfileDir(false) });
  await stopCdpChrome({ port: listenPort, profile: cdpProfileDir(true) });

  // Pull daily-browser cookies into the CDP profile before any Chrome starts.
  if (process.env.MAILNOTMILK_IMPORT_PRIMARY !== "0") {
    try {
      const { seedCdpProfileFromPrimaryBrowser } = await import(
        "./primary-browser.js"
      );
      const dest = cdpProfileDir(false);
      const prim = seedCdpProfileFromPrimaryBrowser({
        destProfileDir: dest,
        force: true,
        targets: openUrl ? [openUrl] : [],
      });
      console.error(
        `browser: primary→CDP seed ${prim.ok ? prim.reason : prim.error || "fail"} (${prim.primary || "?"})`
      );
    } catch (err) {
      console.error(`browser: primary→CDP seed error: ${err.message}`);
    }
  }

  const xvfb = await ensureVirtualDisplay();
  if (!xvfb.ok) {
    // No Xvfb — stay pure --headless=new (never spawn headed on user DISPLAY).
    console.error(
      `browser: CF/auto — no Xvfb (${xvfb.error}); launching --headless=new only (no desktop popup)`
    );
    const headlessOnly = await ensureChromeCdp({
      cdpUrl: url,
      port: listenPort,
      startIfMissing: true,
      openUrl,
      headless: "new",
      forceRestart: true,
    });
    return {
      ...headlessOnly,
      headlessMode: "new",
      headless: true,
      warmed: false,
      xvfb: false,
    };
  }

  console.error(
    `browser: CF/auto — warming Chrome on Xvfb ${xvfb.display} (your screen stays empty)…`
  );
  const warm = await ensureChromeCdp({
    cdpUrl: url,
    port: listenPort,
    startIfMissing: true,
    openUrl,
    headless: "offscreen",
    forceRestart: true,
    display: xvfb.display,
  });
  if (!warm.ok) {
    return { ok: false, stage: "warm", error: warm.error || "warm failed", cdpUrl: url };
  }

  if (typeof checkCfFn === "function") {
    const cleared = await checkCfFn({ cdpUrl: url, timeoutMs: waitCfMs });
    if (!cleared?.ok) {
      return {
        ok: false,
        stage: "warm-cf",
        error: cleared?.error || "Cloudflare did not clear during automated warm",
        cdpUrl: url,
        warm,
      };
    }
  } else {
    await new Promise((r) => setTimeout(r, Math.min(waitCfMs, 12_000)));
  }

  const seeded = seedHeadlessProfileFromHeaded({ force: true });
  console.error(
    `browser: CF/auto — seeded headless profile (${seeded.reason || "?"}); relaunching --headless=new`
  );

  await stopCdpChrome({ port: listenPort, profile: warm.profile || cdpProfileDir(false) });
  await stopCdpChrome({ port: listenPort, profile: cdpProfileDir(true) });

  const headless = await ensureChromeCdp({
    cdpUrl: url,
    port: listenPort,
    startIfMissing: true,
    openUrl,
    headless: "new",
    forceRestart: true,
  });
  if (!headless.ok) {
    return {
      ok: false,
      stage: "headless-new",
      error: headless.error || "headless=new failed to start",
      cdpUrl: url,
      seeded,
    };
  }

  return {
    ok: true,
    cdpUrl: headless.cdpUrl || url,
    headlessMode: "new",
    headless: true,
    seeded,
    warmed: true,
    xvfb: xvfb.display,
    started: true,
    bin: headless.bin,
    profile: headless.profile,
  };
}

/**
 * Ensure a CDP endpoint is reachable.
 * headless=true → `--headless=new` by default (or offscreen headed via env).
 */
export async function ensureChromeCdp({
  cdpUrl = null,
  port = null,
  startIfMissing = true,
  openUrl = null,
  headless = false,
  forceRestart = false,
  /** Override DISPLAY. Offscreen never uses the user desktop — Xvfb only. */
  display = null,
} = {}) {
  openUrl = openUrl || process.env.MAILNOTMILK_START_URL || null;
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
    let runningHeadlessNew = false;
    try {
      const out = execSync(`pgrep -af 'remote-debugging-port=${listenPort}'`, {
        encoding: "utf8",
      });
      runningHeadlessNew = /--headless=new\b/.test(out);
    } catch {
      runningHeadlessNew = false;
    }
    const modeMatches =
      (mode === "new" && runningHeadlessNew) ||
      (mode === "offscreen" && !runningHeadlessNew) ||
      (mode === "headed" && !runningHeadlessNew);
    if (modeMatches) {
      return {
        ok: true,
        cdpUrl: url,
        started: false,
        bin: null,
        headless: wantsIsolated,
        headlessMode: mode,
      };
    }
    // Wrong chrome flavor on this port — restart into the requested mode.
    await stopCdpChrome({ port: listenPort });
  }
  if (!startIfMissing) {
    return { ok: false, cdpUrl: url, started: false, bin: null, error: "CDP not available" };
  }

  const bin = findChromeBin();
  if (!bin) {
    return { ok: false, cdpUrl: url, started: false, bin: null, error: "Chrome/Chromium binary not found" };
  }

  let seeded = null;
  let primarySeed = null;
  // Prefer the warm headed profile for BOTH Xvfb warm and --headless=new.
  // Copying cookies into a second profile often loses CF clearance; same
  // user-data-dir keeps clearance when we relaunch with --headless=new.
  const headedProfile = cdpProfileDir(false);
  const useHeadedProfile =
    (mode === "offscreen" || mode === "new") &&
    existsSync(join(headedProfile, "Default"));
  if (mode === "new" && !useHeadedProfile) {
    seeded = seedHeadlessProfileFromHeaded({ force: false });
  }
  const profile = useHeadedProfile
    ? headedProfile
    : cdpProfileDir(mode === "new" || mode === "offscreen");

  // Import login/CF cookies from the user's daily Chrome into this CDP profile
  // BEFORE launch — dynamic hosts from openUrl (any site).
  if (process.env.MAILNOTMILK_IMPORT_PRIMARY !== "0") {
    try {
      const { seedCdpProfileFromPrimaryBrowser } = await import(
        "./primary-browser.js"
      );
      // Must not overwrite a running Chrome's DB — caller should stop first.
      primarySeed = seedCdpProfileFromPrimaryBrowser({
        destProfileDir: profile,
        force: Boolean(forceRestart) || process.env.MAILNOTMILK_IMPORT_PRIMARY === "force",
        targets: openUrl ? [openUrl] : [],
      });
      if (primarySeed?.ok) {
        console.error(
          `browser: imported primary Chrome session → ${profile} (${primarySeed.reason}; hosts=${(primarySeed.hosts || []).join(",") || "all"})`
        );
      }
    } catch (err) {
      console.error(`browser: primary Chrome import skipped: ${err.message}`);
    }
  }

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
    // Headed binary for CF warm — MUST run on Xvfb, never the user DISPLAY.
    args.push("--window-position=0,0");
  }

  if (openUrl) args.push(openUrl);

  const spawnEnv = { ...process.env };
  if (mode === "new") {
    // True headless — no X11 window; drop DISPLAY so nothing can flash.
    delete spawnEnv.DISPLAY;
    delete spawnEnv.WAYLAND_DISPLAY;
  } else if (mode === "offscreen") {
    let disp = display;
    if (!disp) {
      const xv = await ensureVirtualDisplay();
      if (!xv.ok) {
        return {
          ok: false,
          cdpUrl: url,
          started: false,
          bin,
          error: `refusing offscreen on user desktop (${xv.error}). Install xvfb or use headless=new.`,
        };
      }
      disp = xv.display;
    }
    spawnEnv.DISPLAY = disp;
    delete spawnEnv.WAYLAND_DISPLAY;
  } else if (display) {
    spawnEnv.DISPLAY = display;
  }

  console.error(
    `browser: starting ${bin} CDP :${listenPort} (${mode}${
      spawnEnv.DISPLAY ? ` DISPLAY=${spawnEnv.DISPLAY}` : " no-DISPLAY"
    }, profile ${profile})`
  );
  const child = spawn(bin, args, {
    detached: true,
    stdio: "ignore",
    env: spawnEnv,
  });
  child.unref();

  const probeMs = latency().cdpProbeMs;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, probeMs));
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
        primarySeed,
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
    primarySeed,
    error: "Chrome started but CDP did not come up",
  };
}
