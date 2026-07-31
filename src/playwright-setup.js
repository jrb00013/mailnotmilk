/**
 * Auto-install Playwright + browser binaries for relay.
 * Supports: macOS, Linux native, Windows native, Windows WSL.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform, arch } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export function detectPlatform() {
  const os = platform(); // win32 | darwin | linux
  let env = "unknown";
  let isWsl = false;

  if (os === "win32") {
    env = "windows-native";
  } else if (os === "darwin") {
    env = "macos";
  } else if (os === "linux") {
    try {
      const v = readFileSync("/proc/version", "utf8").toLowerCase();
      if (v.includes("microsoft") || v.includes("wsl")) {
        isWsl = true;
        env = "windows-wsl";
      } else {
        env = "linux-native";
      }
    } catch {
      env = "linux-native";
    }
  }

  return {
    os,
    arch: arch(),
    env,
    isWsl,
    isWindows: os === "win32",
    isMac: os === "darwin",
    isLinux: os === "linux",
    home: homedir(),
  };
}

function run(cmd, args, { cwd = PKG_ROOT, inherit = true, env = process.env } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
    shell: platform() === "win32",
    env,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

export function playwrightResolvable() {
  try {
    require.resolve("playwright", { paths: [PKG_ROOT, process.cwd()] });
    return true;
  } catch {
    return false;
  }
}

export function ensureNpmPlaywright() {
  if (playwrightResolvable()) {
    console.log("  ✓ playwright npm package present");
    return { installed: false, ok: true };
  }
  console.log("  → npm install playwright (and deps)…");
  const npm = platform() === "win32" ? "npm.cmd" : "npm";
  // Prefer installing all package deps so lockfile stays consistent
  let r = run(npm, ["install"], { cwd: PKG_ROOT });
  if (!r.ok) {
    r = run(npm, ["install", "playwright@^1.49.0", "--save"], { cwd: PKG_ROOT });
  }
  if (!playwrightResolvable()) {
    throw new Error(
      "Failed to install playwright npm package. Check network / npm permissions."
    );
  }
  return { installed: true, ok: true };
}

function browsersToInstall(plat) {
  // Chromium + Firefox everywhere; WebKit is useful on macOS and available elsewhere.
  const list = ["chromium", "firefox"];
  if (plat.isMac || plat.isWindows || plat.isLinux) list.push("webkit");
  return list;
}

/**
 * Install browser binaries. On Linux/WSL, attempt OS deps (best-effort; may need sudo).
 */
export function ensurePlaywrightBrowsers({ withDeps = null } = {}) {
  const plat = detectPlatform();
  const browsers = browsersToInstall(plat);
  const npx = plat.isWindows ? "npx.cmd" : "npx";

  console.log(`  platform: ${plat.env} (${plat.os}/${plat.arch})`);
  console.log(`  → playwright install ${browsers.join(" ")}`);

  // Prefer local node_modules/.bin/playwright when present
  const localBin = join(
    PKG_ROOT,
    "node_modules",
    ".bin",
    plat.isWindows ? "playwright.cmd" : "playwright"
  );
  const useLocal = existsSync(localBin);

  let r;
  const installEnv = {
    ...process.env,
    // Avoid interactive host checks when we manage deps ourselves
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS:
      withDeps === false ? "1" : process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS || "",
  };
  if (useLocal) {
    r = run(localBin, ["install", ...browsers], { cwd: PKG_ROOT, env: installEnv });
  } else {
    r = run(npx, ["--yes", "playwright", "install", ...browsers], {
      cwd: PKG_ROOT,
      env: installEnv,
    });
  }

  if (!r.ok) {
    throw new Error(
      `playwright install failed (status ${r.status}). On Linux/WSL you may need: sudo npx playwright install-deps`
    );
  }

  const wantDeps =
    withDeps === null
      ? plat.isLinux // linux-native + wsl
      : Boolean(withDeps);

  if (wantDeps) {
    console.log("  → playwright install-deps (Linux/WSL system libraries, best-effort)…");
    const depArgs = ["install-deps", ...browsers];
    // Use current Node (nvm/fnm), not system node via bare sudo
    const nodeBin = process.execPath;
    const pwCli = join(PKG_ROOT, "node_modules", "playwright", "cli.js");
    let dep = existsSync(pwCli)
      ? run(nodeBin, [pwCli, ...depArgs], { cwd: PKG_ROOT })
      : useLocal
        ? run(localBin, depArgs, { cwd: PKG_ROOT })
        : run(npx, ["--yes", "playwright", ...depArgs], { cwd: PKG_ROOT });

    if (!dep.ok) {
      const sudo = (() => {
        try {
          execSync("command -v sudo", { encoding: "utf8" });
          return true;
        } catch {
          return false;
        }
      })();
      if (sudo && existsSync(pwCli)) {
        console.log("  → retrying install-deps with sudo -E (keep PATH/node)…");
        const again = run(
          "sudo",
          ["-E", nodeBin, pwCli, ...depArgs],
          { cwd: PKG_ROOT }
        );
        if (!again.ok) {
          console.log(
            "  ~ install-deps needs interactive sudo or apt fixes — browser binaries are still installed"
          );
        } else {
          console.log("  ✓ install-deps via sudo");
        }
      } else {
        console.log(
          "  ~ install-deps skipped/failed. If launch fails, run: sudo -E $(which node) node_modules/playwright/cli.js install-deps"
        );
      }
    } else {
      console.log("  ✓ install-deps");
    }
  }

  if (plat.isWsl) {
    console.log(
      "  note: WSL relay UI needs WSLg or an X server; headless still works with --headless"
    );
  }

  console.log(`  ✓ browsers ready: ${browsers.join(", ")}`);
  return { ok: true, platform: plat, browsers };
}

/** Full relay toolchain setup used by `./install.sh`. */
export async function ensureRelayRuntime({ skipBrowsers = false, withDeps = null } = {}) {
  console.log("\nInstalling browser relay runtime (Playwright)…");
  const plat = detectPlatform();
  console.log(`  detected: ${plat.env}`);

  ensureNpmPlaywright();
  if (skipBrowsers) {
    console.log("  ~ skipping browser binaries (--skip-browsers)");
    return { ok: true, platform: plat, browsers: [] };
  }
  return ensurePlaywrightBrowsers({ withDeps });
}
