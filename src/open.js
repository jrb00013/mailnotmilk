import { spawn } from "node:child_process";
import http from "node:http";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/mailnotmilk.js", import.meta.url));

export function openUrl(url) {
  const cmd =
    platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => resolve(false));
    child.unref();
    resolve(true);
  });
}

function probe(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/chats`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Start hub in background if not already up; return base URL. Never uses bare `mailnotmilk` on PATH. */
export async function ensureHub(port = 7879) {
  const base = `http://127.0.0.1:${port}`;
  if (await probe(port)) {
    console.error(`hub already up: ${base}`);
    return base;
  }

  console.error(`starting hub: ${process.execPath} ${CLI} hub -p ${port}`);
  const child = spawn(process.execPath, [CLI, "hub", "-p", String(port)], {
    stdio: "ignore",
    detached: true,
    env: process.env,
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  child.unref();

  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await probe(port)) {
      console.error(`hub: ${base}`);
      return base;
    }
  }
  throw new Error(
    `Could not start hub on ${base}. Try: ${process.execPath} ${CLI} hub`
  );
}

