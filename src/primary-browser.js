/**
 * Import session cookies from the user's daily browsers (Firefox and/or Chrome)
 * into the mailnotmilk headless CDP Chrome context.
 *
 * Auto-detects Snap/system Firefox + Chrome. Hosts are derived from the target
 * URL at runtime — no vendor hardcoding.
 */

import {
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  readdirSync,
  statSync,
  copyFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, platform, tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Candidate user-data roots for daily Chrome (not mailnotmilk CDP). */
export function findPrimaryChromeUserDataDirs() {
  const env =
    process.env.MAILNOTMILK_PRIMARY_CHROME_USER_DATA ||
    process.env.CHROME_USER_DATA_DIR ||
    null;
  const home = homedir();
  const candidates =
    platform() === "darwin"
      ? [
          env,
          join(home, "Library/Application Support/Google/Chrome"),
          join(home, "Library/Application Support/Chromium"),
        ]
      : platform() === "win32"
        ? [
            env,
            process.env.LOCALAPPDATA &&
              join(process.env.LOCALAPPDATA, "Google/Chrome/User Data"),
            process.env.LOCALAPPDATA &&
              join(process.env.LOCALAPPDATA, "Chromium/User Data"),
          ]
        : [
            env,
            join(home, ".config/google-chrome"),
            join(home, ".config/chromium"),
            join(home, "snap/chromium/common/chromium"),
          ];

  return candidates.filter((p) => p && existsSync(join(p, "Local State")));
}

export function findPrimaryChromeProfileDir({ profile = "Default" } = {}) {
  const roots = findPrimaryChromeUserDataDirs();
  const wanted =
    process.env.MAILNOTMILK_PRIMARY_CHROME_PROFILE || profile || "Default";
  for (const root of roots) {
    const dir = join(root, wanted);
    if (existsSync(join(dir, "Cookies")) || existsSync(join(dir, "Preferences"))) {
      return { ok: true, browser: "chrome", userDataDir: root, profileDir: dir, profile: wanted };
    }
    try {
      for (const name of readdirSync(root)) {
        const p = join(root, name);
        if (existsSync(join(p, "Cookies"))) {
          return { ok: true, browser: "chrome", userDataDir: root, profileDir: p, profile: name };
        }
      }
    } catch {
      /* ignore */
    }
  }
  return { ok: false, error: "primary Chrome profile not found" };
}

/** Firefox profile roots: Snap, system, Flatpak, macOS, Windows. */
export function findFirefoxProfileRoots() {
  const env = process.env.MAILNOTMILK_PRIMARY_FIREFOX_HOME || null;
  const home = homedir();
  const candidates =
    platform() === "darwin"
      ? [env, join(home, "Library/Application Support/Firefox")]
      : platform() === "win32"
        ? [
            env,
            process.env.APPDATA && join(process.env.APPDATA, "Mozilla/Firefox"),
          ]
        : [
            env,
            join(home, "snap/firefox/common/.mozilla/firefox"),
            join(home, ".mozilla/firefox"),
            join(home, ".var/app/org.mozilla.firefox/.mozilla/firefox"),
          ];
  return candidates.filter((p) => p && existsSync(p));
}

/**
 * Resolve the default Firefox profile (profiles.ini Path=… Default=1).
 */
export function findPrimaryFirefoxProfileDir() {
  for (const root of findFirefoxProfileRoots()) {
    const ini = join(root, "profiles.ini");
    let pathRel = null;
    if (existsSync(ini)) {
      try {
        const text = readFileSync(ini, "utf8");
        const blocks = text.split(/\n\s*\n/);
        let fallback = null;
        for (const block of blocks) {
          const pathM = block.match(/^Path=(.+)$/m);
          if (!pathM) continue;
          const isDefault = /^Default=1\s*$/m.test(block);
          if (isDefault) pathRel = pathM[1].trim();
          if (!fallback) fallback = pathM[1].trim();
        }
        if (!pathRel) pathRel = fallback;
      } catch {
        /* ignore */
      }
    }
    if (pathRel) {
      const dir = pathRel.startsWith("/") ? pathRel : join(root, pathRel);
      if (existsSync(join(dir, "cookies.sqlite"))) {
        return { ok: true, browser: "firefox", profileDir: dir, root };
      }
    }
    // Walk for any cookies.sqlite
    try {
      for (const name of readdirSync(root)) {
        const dir = join(root, name);
        if (existsSync(join(dir, "cookies.sqlite"))) {
          return { ok: true, browser: "firefox", profileDir: dir, root };
        }
      }
    } catch {
      /* ignore */
    }
  }
  return { ok: false, error: "primary Firefox profile not found" };
}

/**
 * Derive cookie host suffixes from any URL or hostname — site-agnostic.
 */
export function hostsForTarget(target) {
  if (!target) return [];
  let host = String(target).trim().toLowerCase();
  try {
    if (!host.includes("://")) host = `https://${host}`;
    host = new URL(host).hostname;
  } catch {
    host = host.replace(/^https?:\/\//, "").split("/")[0];
  }
  if (!host) return [];
  const parts = host.split(".").filter(Boolean);
  const out = new Set([host, `.${host}`]);
  if (parts.length >= 2) {
    const base = parts.slice(-2).join(".");
    out.add(base);
    out.add(`.${base}`);
  }
  if (parts.length >= 3) {
    const base3 = parts.slice(-3).join(".");
    out.add(base3);
    out.add(`.${base3}`);
  }
  return [...out];
}

function hostMatches(cookieHost, wantedHosts) {
  const h = String(cookieHost || "").toLowerCase();
  if (!wantedHosts?.length) return true;
  return wantedHosts.some((w) => {
    const ww = String(w).toLowerCase().replace(/^\./, "");
    const hh = h.replace(/^\./, "");
    return hh === ww || hh.endsWith(`.${ww}`) || h === w;
  });
}

function copyDbToTemp(src) {
  const tmpRoot = mkdtempSync(join(tmpdir(), "mailnotmilk-cdb-"));
  const tmp = join(tmpRoot, "cookies.db");
  copyFileSync(src, tmp);
  // Also try -wal/-shm companions for a consistent snapshot
  for (const suf of ["-wal", "-shm"]) {
    const side = src + suf;
    if (existsSync(side)) {
      try {
        copyFileSync(side, tmp + suf);
      } catch {
        /* ignore */
      }
    }
  }
  return { tmp, tmpRoot };
}

/**
 * Read Firefox moz_cookies into Playwright cookie objects.
 */
export function extractFirefoxCookies({ targets = [], profileDir = null } = {}) {
  const prof = profileDir
    ? { ok: true, profileDir, browser: "firefox" }
    : findPrimaryFirefoxProfileDir();
  if (!prof.ok) return { ok: false, error: prof.error, cookies: [], browser: "firefox" };

  const dbPath = join(prof.profileDir, "cookies.sqlite");
  if (!existsSync(dbPath)) {
    return { ok: false, error: "cookies.sqlite missing", cookies: [], browser: "firefox" };
  }

  const hosts = [...new Set(targets.flatMap(hostsForTarget))];
  const { tmp, tmpRoot } = copyDbToTemp(dbPath);
  const cookies = [];
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    const rows = db.prepare(
      `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite
       FROM moz_cookies`
    ).all();
    for (const row of rows) {
      if (!hostMatches(row.host, hosts)) continue;
      if (!row.value) continue;
      let sameSite = "Lax";
      if (row.sameSite === 0) sameSite = "None";
      else if (row.sameSite === 1) sameSite = "Lax";
      else if (row.sameSite === 2) sameSite = "Strict";
      const domain = String(row.host || "");
      cookies.push({
        name: row.name,
        value: row.value,
        domain,
        path: row.path || "/",
        expires: row.expiry > 0 ? row.expiry : undefined,
        httpOnly: Boolean(row.isHttpOnly),
        secure: Boolean(row.isSecure),
        sameSite,
      });
    }
    db.close();
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      cookies: [],
      browser: "firefox",
      profileDir: prof.profileDir,
    };
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  return {
    ok: cookies.length > 0,
    cookies,
    count: cookies.length,
    browser: "firefox",
    profileDir: prof.profileDir,
    hosts,
    score: scoreSessionCookies(cookies),
  };
}

/** Heuristic: session/auth cookies score higher than analytics crumbs. */
export function scoreSessionCookies(cookies) {
  let score = 0;
  for (const c of cookies || []) {
    const n = (c.name || "").toLowerCase();
    if (/session-token|sessionid|auth|access_token|refresh|login|sid|__secure-next-auth/i.test(n)) {
      score += 100 + Math.min(String(c.value || "").length, 500);
    } else if (/cf_clearance|oai-sc|csrf|__cf/i.test(n)) {
      score += 20;
    } else {
      score += 1;
    }
  }
  return score;
}

/**
 * Auto-detect best primary browser cookie jar for the given targets.
 * Prefers Firefox when it has real session tokens (Chrome jars are often encrypted).
 */
export function extractPrimaryCookies({ targets = [] } = {}) {
  const prefer = (process.env.MAILNOTMILK_PRIMARY_BROWSER || "auto").toLowerCase();
  const results = [];

  if (prefer === "auto" || prefer === "firefox" || prefer === "ff") {
    results.push(extractFirefoxCookies({ targets }));
  }
  if (prefer === "auto" || prefer === "chrome" || prefer === "chromium") {
    // Chrome cookie values are OSCrypt-encrypted — profile seed is separate.
    // We still report discovery for logging.
    const chrome = findPrimaryChromeProfileDir();
    results.push({
      ok: chrome.ok,
      cookies: [],
      browser: "chrome",
      profileDir: chrome.profileDir,
      note: "chrome uses profile file seed (encrypted cookies); use Firefox inject for plaintext sessions",
      score: chrome.ok ? 1 : 0,
    });
  }

  const usable = results
    .filter((r) => r.ok && (r.cookies?.length || 0) > 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (usable.length) {
    return {
      ok: true,
      ...usable[0],
      candidates: results.map((r) => ({
        browser: r.browser,
        ok: r.ok,
        count: r.cookies?.length || 0,
        score: r.score || 0,
        profileDir: r.profileDir,
        error: r.error,
      })),
    };
  }

  return {
    ok: false,
    cookies: [],
    error: "no primary-browser session cookies found for targets",
    candidates: results.map((r) => ({
      browser: r.browser,
      ok: r.ok,
      count: r.cookies?.length || 0,
      score: r.score || 0,
      profileDir: r.profileDir,
      error: r.error,
      note: r.note,
    })),
    hosts: [...new Set(targets.flatMap(hostsForTarget))],
  };
}

/**
 * Inject Playwright-shaped cookies into a BrowserContext (CDP / launch).
 */
export async function injectCookiesIntoContext(context, cookies) {
  if (!context?.addCookies || !cookies?.length) {
    return { ok: false, injected: 0 };
  }
  // Playwright wants domain without scheme; expiry in seconds.
  const payload = cookies.map((c) => {
    const out = {
      name: c.name,
      value: c.value,
      path: c.path || "/",
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: c.sameSite || "Lax",
    };
    if (c.domain) out.domain = c.domain;
    if (c.url) out.url = c.url;
    if (c.expires && c.expires > 0) {
      // Firefox expiry is already unix seconds; guard ms-looking values
      out.expires = c.expires > 1e12 ? Math.floor(c.expires / 1000) : c.expires;
    }
    return out;
  });
  try {
    await context.addCookies(payload);
    return { ok: true, injected: payload.length };
  } catch (err) {
    // Retry one-by-one so a bad sameSite doesn't kill the jar
    let injected = 0;
    for (const c of payload) {
      try {
        await context.addCookies([c]);
        injected += 1;
      } catch {
        /* skip */
      }
    }
    return {
      ok: injected > 0,
      injected,
      error: err.message,
    };
  }
}

function safeCopyFile(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(join(dest, ".."), { recursive: true });
  const tmpRoot = mkdtempSync(join(tmpdir(), "mailnotmilk-cookie-"));
  try {
    const tmp = join(tmpRoot, "blob");
    copyFileSync(src, tmp);
    cpSync(tmp, dest, { force: true });
    return true;
  } catch {
    try {
      cpSync(src, dest, { force: true });
      return true;
    } catch {
      return false;
    }
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function safeCopyTree(src, dest) {
  if (!existsSync(src)) return false;
  try {
    mkdirSync(join(dest, ".."), { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Seed CDP profile files from primary Chrome (encrypted cookie DB + Local State).
 * Pair with extractPrimaryCookies() + injectCookiesIntoContext() for Firefox.
 */
export function seedCdpProfileFromPrimaryBrowser({
  destProfileDir,
  force = false,
  targets = [],
} = {}) {
  if (!destProfileDir) {
    return { ok: false, error: "destProfileDir required" };
  }
  const primary = findPrimaryChromeProfileDir();
  if (!primary.ok) return primary;

  const destDefault = join(destProfileDir, "Default");
  const destCookies = join(destDefault, "Cookies");
  if (!force && existsSync(destCookies)) {
    try {
      if (statSync(destCookies).size > 1024) {
        return {
          ok: true,
          reason: "already-seeded",
          primary: primary.profileDir,
          dest: destProfileDir,
          hosts: targets.flatMap(hostsForTarget),
        };
      }
    } catch {
      /* continue */
    }
  }

  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      rmSync(join(destProfileDir, name), { force: true });
    } catch {
      /* ignore */
    }
  }
  mkdirSync(destDefault, { recursive: true });

  const copied = [];
  const fileNames = [
    "Cookies",
    "Cookies-journal",
    "Login Data",
    "Login Data-journal",
    "Web Data",
    "Web Data-journal",
    "Preferences",
    "Secure Preferences",
  ];
  for (const name of fileNames) {
    if (safeCopyFile(join(primary.profileDir, name), join(destDefault, name))) {
      copied.push(name);
    }
  }
  for (const name of ["Local Storage", "Session Storage", "IndexedDB", "Network"]) {
    if (safeCopyTree(join(primary.profileDir, name), join(destDefault, name))) {
      copied.push(name);
    }
  }

  const primaryLocalState = join(primary.userDataDir, "Local State");
  const destLocalState = join(destProfileDir, "Local State");
  if (safeCopyFile(primaryLocalState, destLocalState)) {
    copied.push("Local State");
  }

  const hosts = [...new Set(targets.flatMap(hostsForTarget))];
  return {
    ok: copied.length > 0,
    reason: copied.length ? "seeded-from-primary-chrome" : "nothing-copied",
    copied,
    primary: primary.profileDir,
    userDataDir: primary.userDataDir,
    dest: destProfileDir,
    hosts,
  };
}
