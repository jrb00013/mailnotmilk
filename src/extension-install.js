/**
 * Auto-install the mailnotmilk Chrome extension so a normal Chrome shortcut
 * loads it — no chrome://extensions → Load unpacked.
 *
 * Strategy (in order):
 * 1. Copy extension → ~/.mailnotmilk/extension (stable path)
 * 2. Pack .crx with a persistent key (chrome --pack-extension or openssl fallback)
 * 3. Register via Chrome External Extensions / Windows registry
 * 4. Write a user Chrome .desktop launcher with --load-extension (Linux)
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  cpSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { spawn, execFileSync, execSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dataDir, ensureDataDir } from "./paths.js";

const PKG_EXT = join(dirname(fileURLToPath(import.meta.url)), "..", "extension");

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
            join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
            join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
            join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
          ]
        : [
            "/usr/bin/google-chrome-stable",
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
          ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  try {
    const cmd = platform() === "win32" ? "where" : "command -v";
    for (const name of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]) {
      try {
        const out = execSync(`${cmd} ${name}`, { encoding: "utf8" }).trim().split(/\r?\n/)[0];
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

/** Chrome extension id from DER-encoded RSA public key (SPKI). */
export function extensionIdFromPublicKeyDer(der) {
  const hash = createHash("sha256").update(der).digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0xf));
  }
  return id;
}

function ensureKeyPair(keyPath) {
  if (existsSync(keyPath)) {
    const pem = readFileSync(keyPath, "utf8");
    const privateKey = createPrivateKey(pem);
    const publicKey = createPublicKey(privateKey);
    return { privateKey, publicKey, pem };
  }
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  // Chrome --pack-extension-key requires PKCS#8 PEM
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, pem, { mode: 0o600 });
  return {
    privateKey,
    publicKey,
    pem,
  };
}

/** Base64 SPKI for manifest "key" field (stable unpacked id). */
function manifestKeyFromPublic(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return Buffer.from(der).toString("base64");
}

function syncExtensionTree(destDir, keyB64) {
  mkdirSync(destDir, { recursive: true });
  cpSync(PKG_EXT, destDir, { recursive: true });
  const manifestPath = join(destDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.key = keyB64;
  // bump patch so Chrome notices updates when we reinstall
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifest.version || "1.0.0";
}

function packWithChrome(chromeBin, extDir, keyPath, crxOut) {
  // Chrome writes <extDir>.crx next to the folder and may write .pem beside it
  const parent = dirname(extDir);
  const base = extDir.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
  const produced = join(parent, `${base}.crx`);
  try {
    if (existsSync(produced)) rmSync(produced);
  } catch {
    /* ignore */
  }
  const args = [
    `--pack-extension=${extDir}`,
    `--pack-extension-key=${keyPath}`,
    "--no-message-box",
  ];
  const r = spawnSync(chromeBin, args, {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, DISPLAY: process.env.DISPLAY || "" },
  });
  if (!existsSync(produced)) {
    throw new Error(
      `chrome pack failed (status ${r.status}): ${(r.stderr || r.stdout || "").slice(0, 400)}`
    );
  }
  mkdirSync(dirname(crxOut), { recursive: true });
  copyFileSync(produced, crxOut);
  try {
    rmSync(produced);
  } catch {
    /* ignore */
  }
  return crxOut;
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

function linuxExternalDirs() {
  const home = homedir();
  return [
    join(home, ".config", "google-chrome", "External Extensions"),
    join(home, ".config", "google-chrome-beta", "External Extensions"),
    join(home, ".config", "chromium", "External Extensions"),
    join(home, ".config", "BraveSoftware", "Brave-Browser", "External Extensions"),
    // system paths (may need sudo)
    "/opt/google/chrome/extensions",
    "/usr/share/google-chrome/extensions",
    "/usr/share/chromium/extensions",
  ];
}

function macExternalDirs() {
  const home = homedir();
  return [
    join(home, "Library", "Application Support", "Google", "Chrome", "External Extensions"),
    join(home, "Library", "Application Support", "Chromium", "External Extensions"),
    join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser", "External Extensions"),
  ];
}

function writeExternalPref(dir, extensionId, crxPath, version, results) {
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${extensionId}.json`);
    writeJson(file, {
      external_crx: crxPath,
      external_version: version,
    });
    // world-readable helps Chrome/snap
    try {
      chmodSync(file, 0o644);
      chmodSync(crxPath, 0o644);
    } catch {
      /* ignore */
    }
    results.push({ ok: true, path: file });
  } catch (err) {
    results.push({ ok: false, path: dir, error: err.message });
  }
}

function writeExternalWithSudo(dir, extensionId, crxPath, version, results) {
  const file = join(dir, `${extensionId}.json`);
  const body = JSON.stringify(
    { external_crx: crxPath, external_version: version },
    null,
    2
  );
  try {
    execFileSync(
      "sudo",
      ["-n", "tee", file],
      { input: body + "\n", encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
    );
    results.push({ ok: true, path: file, sudo: true });
  } catch {
    results.push({
      ok: false,
      path: file,
      error: "needs passwordless sudo (skipped)",
    });
  }
}

function writeWindowsRegistry(extensionId, crxPath, version, results) {
  const key = `HKCU\\Software\\Google\\Chrome\\Extensions\\${extensionId}`;
  try {
    execFileSync("reg", ["add", key, "/ve", "/d", "mailnotmilk", "/f"], {
      stdio: "ignore",
    });
    execFileSync("reg", ["add", key, "/v", "path", "/t", "REG_SZ", "/d", crxPath, "/f"], {
      stdio: "ignore",
    });
    execFileSync(
      "reg",
      ["add", key, "/v", "version", "/t", "REG_SZ", "/d", version, "/f"],
      { stdio: "ignore" }
    );
    results.push({ ok: true, path: key });
  } catch (err) {
    results.push({ ok: false, path: key, error: err.message });
  }
}

/** Linux: user desktop entries so the normal Chrome shortcut loads the extension. */
function writeLinuxDesktopLauncher(chromeBin, extDir, results) {
  const apps = join(homedir(), ".local", "share", "applications");
  mkdirSync(apps, { recursive: true });
  const execLine = `${chromeBin} --load-extension=${extDir} %U`;
  const desktop = join(apps, "mailnotmilk-chrome.desktop");
  writeFileSync(
    desktop,
    `[Desktop Entry]
Version=1.0
Name=Google Chrome (mailnotmilk)
GenericName=Web Browser
Comment=Chrome with mailnotmilk extension preloaded
Exec=${execLine}
Terminal=false
Type=Application
Icon=google-chrome
Categories=Network;WebBrowser;
StartupNotify=true
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
`
  );
  chmodSync(desktop, 0o755);
  results.push({ ok: true, path: desktop, note: "launcher" });

  for (const name of [
    "google-chrome.desktop",
    "google-chrome-stable.desktop",
    "chromium-browser.desktop",
    "chromium.desktop",
  ]) {
    const systemCandidates = [
      `/usr/share/applications/${name}`,
      join(apps, name),
    ];
    let src = null;
    for (const c of systemCandidates) {
      if (existsSync(c)) {
        src = c;
        break;
      }
    }
    if (!src) continue;
    try {
      let txt = readFileSync(src, "utf8");
      if (txt.includes("--load-extension=")) {
        txt = txt.replace(/--load-extension=[^\s]+/g, `--load-extension=${extDir}`);
      } else {
        txt = txt.replace(/^(Exec=)(\S+)(.*)$/gm, (_m, p, bin, rest) => {
          if (/uninstall/i.test(bin)) return _m;
          return `${p}${bin} --load-extension=${extDir}${rest}`;
        });
      }
      writeFileSync(join(apps, name), txt);
      results.push({ ok: true, path: join(apps, name), note: "desktop-override" });
    } catch (err) {
      results.push({ ok: false, path: name, error: err.message });
    }
  }

  try {
    execSync("update-desktop-database ~/.local/share/applications 2>/dev/null || true", {
      shell: true,
    });
  } catch {
    /* ignore */
  }
}

/**
 * Full auto-install. Safe to call repeatedly.
 */
export function installChromeExtension() {
  ensureDataDir();
  const root = join(dataDir(), "extension-dist");
  const extDir = join(root, "extension");
  const keyPath = join(dataDir(), "extension-key.pem");
  const crxPath = join(dataDir(), "mailnotmilk.crx");

  const { publicKey } = ensureKeyPair(keyPath);
  const keyB64 = manifestKeyFromPublic(publicKey);
  const der = publicKey.export({ type: "spki", format: "der" });
  const extensionId = extensionIdFromPublicKeyDer(der);
  const version = syncExtensionTree(extDir, keyB64);

  const results = [];
  const chromeBin = findChromeBin();

  let packed = false;
  if (chromeBin) {
    try {
      packWithChrome(chromeBin, extDir, keyPath, crxPath);
      packed = true;
      results.push({ ok: true, path: crxPath, note: "crx" });
    } catch (err) {
      results.push({ ok: false, path: "pack", error: err.message });
    }
  } else {
    results.push({ ok: false, path: "pack", error: "Chrome/Chromium binary not found" });
  }

  if (packed && existsSync(crxPath)) {
    if (platform() === "win32") {
      writeWindowsRegistry(extensionId, crxPath, version, results);
    } else if (platform() === "darwin") {
      for (const dir of macExternalDirs()) {
        writeExternalPref(dir, extensionId, crxPath, version, results);
      }
    } else {
      for (const dir of linuxExternalDirs()) {
        if (dir.startsWith("/opt/") || dir.startsWith("/usr/")) {
          if (existsSync(dirname(dir)) || existsSync(dir)) {
            writeExternalWithSudo(dir, extensionId, crxPath, version, results);
          }
        } else {
          writeExternalPref(dir, extensionId, crxPath, version, results);
        }
      }
    }
  }

  // Always ensure --load-extension launcher on Linux (works even without CRX)
  if (platform() === "linux" && chromeBin) {
    writeLinuxDesktopLauncher(chromeBin, extDir, results);
  }

  // Windows: write a small launcher .cmd next to start menu is heavy; registry is enough.
  // macOS: write a tiny wrapper script
  if (platform() === "darwin" && chromeBin) {
    const bin = join(homedir(), ".local", "bin");
    mkdirSync(bin, { recursive: true });
    const wrap = join(bin, "mailnotmilk-chrome");
    writeFileSync(
      wrap,
      `#!/bin/bash\nexec ${JSON.stringify(chromeBin)} --load-extension=${JSON.stringify(extDir)} "$@"\n`
    );
    chmodSync(wrap, 0o755);
    results.push({ ok: true, path: wrap, note: "wrapper" });
  }

  const ok = results.some((r) => r.ok);
  return {
    ok,
    extensionId,
    version,
    extDir,
    crxPath: existsSync(crxPath) ? crxPath : null,
    chromeBin,
    results,
    restartChrome: true,
  };
}

/**
 * Start Chrome with the extension loaded (works even if External Extensions
 * hasn't taken effect yet). Safe if Chrome is already running — may open a
 * new window in the existing process (extension may need a full Chrome restart
 * in that case).
 */
export function launchChromeWithExtension(extDir, { url = null, chromeBin = null } = {}) {
  const bin = chromeBin || findChromeBin();
  if (!bin) throw new Error("Chrome/Chromium binary not found");
  if (!extDir || !existsSync(extDir)) throw new Error(`extension dir missing: ${extDir}`);

  const args = [
    `--load-extension=${extDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (url) args.push(url);

  console.error(`browser: launching ${bin} with --load-extension=${extDir}`);
  const child = spawn(bin, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return { ok: true, bin, extDir, pid: child.pid };
}

export function extensionInstallHint(info) {
  const lines = [
    `  ✓ extension id ${info.extensionId}`,
    `  ✓ files at ${info.extDir}`,
  ];
  if (info.crxPath) lines.push(`  ✓ packed ${info.crxPath}`);
  for (const r of info.results.filter((x) => x.ok)) {
    lines.push(`  ✓ registered ${r.path}${r.note ? ` (${r.note})` : ""}`);
  }
  for (const r of info.results.filter((x) => !x.ok && x.error && !/sudo/i.test(x.error))) {
    lines.push(`  ~ ${r.path}: ${r.error}`);
  }
  lines.push("  → Fully quit Chrome once, then open it with your normal shortcut.");
  lines.push("  → Extension loads automatically (any AI site). Then: ./run.sh");
  return lines.join("\n");
}
