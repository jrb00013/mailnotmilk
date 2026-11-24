/**
 * Import session from the user's primary (daily) browser into the mailnotmilk
 * CDP profile — so headless/Xvfb Chrome is already logged in without a fresh
 * login wall.
 *
 * Dynamic: hosts are derived from the target URL / site config at runtime.
 */

import {
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  readdirSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

/** Candidate user-data roots for the daily browser (not mailnotmilk CDP). */
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
      return { ok: true, userDataDir: root, profileDir: dir, profile: wanted };
    }
    // Fallback: first profile that has Cookies
    try {
      for (const name of readdirSync(root)) {
        const p = join(root, name);
        if (existsSync(join(p, "Cookies"))) {
          return { ok: true, userDataDir: root, profileDir: p, profile: name };
        }
      }
    } catch {
      /* ignore */
    }
  }
  return { ok: false, error: "primary Chrome profile not found" };
}

/**
 * Derive cookie host suffixes from any URL or hostname — site-agnostic.
 * e.g. https://chat.example.com/a → ["example.com", "chat.example.com", …]
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

function safeCopyFile(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(join(dest, ".."), { recursive: true });
  // Copy via temp so we can read while Chrome has the live DB open.
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
 * Seed a mailnotmilk CDP profile from the user's primary Chrome so logins /
 * CF clearance / localStorage carry over. Works for any site — pass `targets`
 * (URLs or hosts) when you only want related storage hints in logs.
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

  // OSCrypt key lives in Local State — required to decrypt primary Cookies.
  const primaryLocalState = join(primary.userDataDir, "Local State");
  const destLocalState = join(destProfileDir, "Local State");
  if (safeCopyFile(primaryLocalState, destLocalState)) {
    copied.push("Local State");
  }

  const hosts = [...new Set(targets.flatMap(hostsForTarget))];
  return {
    ok: copied.length > 0,
    reason: copied.length ? "seeded-from-primary" : "nothing-copied",
    copied,
    primary: primary.profileDir,
    userDataDir: primary.userDataDir,
    dest: destProfileDir,
    hosts,
  };
}
