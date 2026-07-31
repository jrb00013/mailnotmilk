/**
 * Type a bootstrap prompt into an already-running agent terminal.
 *
 * There is no way to "reach into" a live Claude Code / Cursor session and hand
 * it a message: its input comes from a pty, not from a buffer another process
 * can write to, and /proc/<pid>/fd/0 is the slave end — writing there paints
 * the screen without ever reaching the program's stdin. The only honest
 * mechanism is synthetic keyboard input delivered to the window, which needs a
 * helper binary (X11 XTEST, or uinput on Wayland).
 *
 * When no helper is installed this module says so and hands back the text to
 * paste, rather than pretending it delivered anything.
 */

import { execFileSync, execSync } from "node:child_process";

function which(cmd) {
  try {
    return execSync(`command -v ${cmd}`, { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** Injection backends in preference order. */
export function detectInjector() {
  if (which("xdotool")) return { tool: "xdotool", display: "x11" };
  if (which("xte")) return { tool: "xte", display: "x11" };
  if (which("ydotool")) return { tool: "ydotool", display: "wayland" };
  return null;
}

/**
 * Windows whose title matches, via xwininfo (no extra dependency).
 * @returns {Array<{id: string, title: string, wmClass: string}>}
 */
export function findWindows(titlePattern) {
  let out;
  try {
    out = execFileSync("xwininfo", ["-root", "-tree"], { encoding: "utf8" });
  } catch {
    return [];
  }
  const re = new RegExp(titlePattern, "i");
  const rows = [];
  for (const line of out.split("\n")) {
    // 0x2a02cb6 "title": ("gnome-terminal-server" "Gnome-terminal")  1854x1048+66+32
    const m = line.match(/^\s*(0x[0-9a-f]+)\s+"([^"]*)":\s*\(([^)]*)\)\s+(\d+)x(\d+)/);
    if (!m) continue;
    const [, id, title, wmClass, w, h] = m;
    // Skip the 1x1 / 10x10 placeholder windows every toolkit litters the tree with.
    if (Number(w) < 100 || Number(h) < 100) continue;
    if (re.test(title)) rows.push({ id, title, wmClass: wmClass.replace(/"/g, "") });
  }
  return rows;
}

/**
 * Type `text` into a window and press Enter.
 * @returns {{ok: boolean, reason?: string, tool?: string, windowId?: string}}
 */
export function injectIntoWindow({ windowId, text, submit = true, delayMs = 12 }) {
  const injector = detectInjector();
  if (!injector) {
    return {
      ok: false,
      reason:
        "no keystroke injector available (install xdotool: sudo apt install -y xdotool). " +
        "dev.tty.legacy_tiocsti is disabled on modern kernels, so tty injection is not a fallback.",
    };
  }
  if (injector.tool !== "xdotool") {
    return {
      ok: false,
      tool: injector.tool,
      reason: `only xdotool supports reliable per-window typing; found ${injector.tool}`,
    };
  }

  try {
    // --window targets the terminal directly, so focus does not have to move
    // and a stray click cannot redirect the keystrokes mid-type.
    execFileSync("xdotool", [
      "type",
      "--window",
      windowId,
      "--delay",
      String(delayMs),
      text,
    ]);
    if (submit) {
      execFileSync("xdotool", ["key", "--window", windowId, "Return"]);
    }
    return { ok: true, tool: "xdotool", windowId };
  } catch (err) {
    return { ok: false, tool: "xdotool", reason: err.message };
  }
}

/**
 * Locate a single matching window and type into it.
 * Ambiguity is an error: typing a prompt into the wrong terminal is worse than
 * doing nothing.
 */
export function injectIntoMatchingWindow({ titlePattern, text, submit = true }) {
  const windows = findWindows(titlePattern);
  if (!windows.length) {
    return { ok: false, reason: `no window title matched /${titlePattern}/i`, windows };
  }
  if (windows.length > 1) {
    return {
      ok: false,
      reason: `${windows.length} windows matched /${titlePattern}/i — narrow the pattern`,
      windows,
    };
  }
  return { ...injectIntoWindow({ windowId: windows[0].id, text, submit }), windows };
}
