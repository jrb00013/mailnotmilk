/**
 * HTTP client for the extension bridge.
 *
 * Why this exists: the extension's command queue lives in `ext-bridge.js`, and
 * only the hub process ever touches it — the extension posts `/api/ext/hello`
 * and long-polls `/api/ext/next` against the hub. But `run-stack`, `relay`,
 * `browser` and the MCP server are *different* processes. They used to import
 * `ext-bridge.js` directly, which gave each one its own empty copy of the
 * queue, so:
 *
 *   - `extStatus()` always reported `connected: false` → `run.sh` stalled ~28s
 *     waiting for a hello that had already arrived, then printed "extension
 *     still silent" and silently downgraded to CDP/Playwright.
 *   - `extRequest()` enqueued into a queue nobody drained → every extension
 *     command timed out after 60s.
 *
 * Module state cannot cross a process boundary. This client goes over HTTP to
 * the hub, which owns the queue. Same API as `ext-bridge.js` so call sites did
 * not have to change.
 */

const DEFAULT_TIMEOUT_MS = 60_000;

/** Base URL of the hub that owns the extension queue. */
export function hubBase() {
  return (
    process.env.MAILNOTMILK_HUB_URL ||
    `http://127.0.0.1:${process.env.MAILNOTMILK_HUB_PORT || 7879}`
  );
}

function url(path) {
  return `${hubBase().replace(/\/$/, "")}${path}`;
}

async function getJson(path, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetch(url(path), {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`hub ${res.status} on ${path}`);
  return res.json();
}

async function postJson(path, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetch(url(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`hub ${res.status} on ${path}`);
  return res.json();
}

/**
 * Current extension status, as the hub sees it.
 *
 * Resolves to a disconnected shape rather than throwing when the hub is down,
 * because callers use this to decide whether to fall back to another browser —
 * a dead hub is exactly the case where they should fall back, not crash.
 */
export async function extStatus() {
  try {
    const st = await getJson("/api/ext/status", { timeoutMs: 3000 });
    return {
      connected: Boolean(st?.connected),
      lastHello: st?.lastHello ?? null,
      pendingCommands: Number(st?.pendingCommands || 0),
      awaitingResults: Number(st?.awaitingResults || 0),
    };
  } catch {
    return {
      connected: false,
      lastHello: null,
      pendingCommands: 0,
      awaitingResults: 0,
    };
  }
}

/**
 * Send one command to the extension and wait for its result.
 *
 * The hub holds the request open until the extension answers or the timeout
 * fires, so this is a normal request/response round trip.
 */
export async function extRequest(type, payload = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const body = await postJson(
      "/api/ext/command",
      // Send the timeout so the hub's own timer matches ours. Without it the
      // hub would hold this request (and its pending entry) for a full 60s
      // after the caller has already given up.
      { type, payload, timeoutMs },
      { timeoutMs: timeoutMs + 2000 }
    );
    if (body?.ok === false) throw new Error(body.error || "extension error");
    return body?.data ?? null;
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(
        `Extension did not respond to ${type} in ${timeoutMs}ms — is the mailnotmilk Chrome extension installed and Chrome open?`
      );
    }
    if (err?.message?.startsWith("hub ")) {
      throw new Error(
        `${err.message} — start the hub first (mailnotmilk hub) or set MAILNOTMILK_HUB_URL.`
      );
    }
    throw err;
  }
}

export async function extListTabs({ timeoutMs } = {}) {
  const data = await extRequest("list_tabs", {}, { timeoutMs });
  // The extension historically returned a bare array here while callers read
  // `.tabs`. Normalise both shapes so either build of the extension works.
  if (Array.isArray(data)) return { tabs: data };
  return data ?? { tabs: [] };
}

export async function extFocusTab({ tabId = null, urlIncludes = null, url = null, timeoutMs } = {}) {
  return extRequest("focus_tab", { tabId, urlIncludes, url }, { timeoutMs });
}

export async function extOpenUrl({ url: target, timeoutMs } = {}) {
  return extRequest("open_url", { url: target }, { timeoutMs });
}

export async function extExtract({ tabId = null, limit = 40, timeoutMs } = {}) {
  return extRequest("extract", { tabId, limit }, { timeoutMs });
}

export async function extSend({ text, tabId = null, submit = true, timeoutMs } = {}) {
  return extRequest("send", { text, tabId, submit }, { timeoutMs });
}

export async function extEval({ tabId = null, code, timeoutMs } = {}) {
  return extRequest("eval", { tabId, code }, { timeoutMs });
}
