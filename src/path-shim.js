/**
 * Put `mailnotmilk` on PATH via ~/.local/bin shim (no global npm required).
 */

import { writeFileSync, mkdirSync, chmodSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_JS = join(PKG_ROOT, "bin", "mailnotmilk.js");

export function localBinDir() {
  if (platform() === "win32") {
    return join(homedir(), "AppData", "Local", "mailnotmilk", "bin");
  }
  return join(homedir(), ".local", "bin");
}

/** Absolute invocation that always works from any cwd. */
export function cliInvocation() {
  return `${process.execPath} ${JSON.stringify(CLI_JS)}`;
}

export function installPathShim() {
  const dir = localBinDir();
  mkdirSync(dir, { recursive: true });

  if (platform() === "win32") {
    const cmdPath = join(dir, "mailnotmilk.cmd");
    writeFileSync(
      cmdPath,
      `@echo off\r\n"${process.execPath}" "${CLI_JS}" %*\r\n`
    );
    console.log(`  ✓ ${cmdPath}`);
    console.log(`  note: ensure on PATH: ${dir}`);
    return { dir, shim: cmdPath };
  }

  const shim = join(dir, "mailnotmilk");
  writeFileSync(
    shim,
    `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_JS)} "$@"\n`
  );
  chmodSync(shim, 0o755);
  console.log(`  ✓ ${shim}`);

  const pathEnv = process.env.PATH || "";
  if (!pathEnv.split(":").includes(dir)) {
    console.log(
      `  ! ${dir} not on PATH yet — open a new shell, or:\n    export PATH="$HOME/.local/bin:$PATH"`
    );
    const bashrc = join(homedir(), ".bashrc");
    const line = 'export PATH="$HOME/.local/bin:$PATH"  # mailnotmilk';
    try {
      const existing = existsSync(bashrc) ? readFileSync(bashrc, "utf8") : "";
      if (!existing.includes("# mailnotmilk")) {
        appendFileSync(bashrc, `\n${line}\n`);
        console.log(`  ✓ appended PATH line to ~/.bashrc`);
      }
    } catch {
      /* ignore */
    }
  } else {
    console.log(`  ✓ ${dir} already on PATH`);
  }

  return { dir, shim };
}
