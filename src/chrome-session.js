/**
 * Attach to Chrome via CDP — no login flow.
 * Uses a dedicated profile under ~/.mailnotmilk/chrome-cdp so CDP always comes up
 * even when your daily Chrome is already open.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
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

function findChromeBin() {
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

function cdpProfileDir() {
  const dir = join(homedir(), ".mailnotmilk", "chrome-cdp");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Ensure a CDP endpoint is reachable.
 * Starts a dedicated Chrome profile with remote debugging (does not fight your daily Chrome).
 */
export async function ensureChromeCdp({
  cdpUrl = "http://127.0.0.1:9222",
  port = 9222,
  startIfMissing = true,
  openUrl = "https://chatgpt.com/",
} = {}) {
  if (await cdpUp(cdpUrl)) {
    return { ok: true, cdpUrl, started: false, bin: null };
  }
  if (!startIfMissing) {
    return { ok: false, cdpUrl, started: false, bin: null, error: "CDP not available" };
  }

  const bin = findChromeBin();
  if (!bin) {
    return { ok: false, cdpUrl, started: false, bin: null, error: "Chrome/Chromium binary not found" };
  }

  const profile = cdpProfileDir();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    openUrl,
  ];

  console.error(
    `browser: starting ${bin} (CDP :${port}, profile ${profile}) — if Cloudflare appears, click Verify once`
  );
  const child = spawn(bin, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await cdpUp(cdpUrl)) {
      return { ok: true, cdpUrl, started: true, bin, profile };
    }
  }
  return {
    ok: false,
    cdpUrl,
    started: true,
    bin,
    profile,
    error: "Chrome started but CDP did not come up",
  };
}
