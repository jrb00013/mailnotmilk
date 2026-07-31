/**
 * Attach to the user's Chrome (or start Chrome with CDP) — no login flow.
 * Login state is irrelevant; we drive whatever session/page is there.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
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

/**
 * Ensure a CDP endpoint is reachable. Never asks the user to log in.
 * If Chrome is already debugging → use it.
 * Else start system Chrome with --remote-debugging-port (fresh or existing process).
 */
export async function ensureChromeCdp({
  cdpUrl = "http://127.0.0.1:9222",
  port = 9222,
  startIfMissing = true,
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

  // Do not touch the locked default profile if Chrome is already open —
  // a second instance with remote debugging is enough; auth is optional.
  const args = [
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
  ];

  console.error(`browser: starting ${bin} (CDP :${port}) — no login required`);
  const child = spawn(bin, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await cdpUp(cdpUrl)) {
      return { ok: true, cdpUrl, started: true, bin };
    }
  }
  return {
    ok: false,
    cdpUrl,
    started: true,
    bin,
    error: "Chrome started but CDP did not come up (another Chrome may own the profile)",
  };
}
