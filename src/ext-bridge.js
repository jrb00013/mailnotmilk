/**
 * In-browser extension bridge — long-poll command queue (no ws dependency).
 * Extension talks to hub; mailnotmilk drives any open tab without CDP flags.
 */

import { randomBytes } from "node:crypto";

/** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
const pending = new Map();

/** @type {object[]} */
const commandQueue = [];

/** @type {Array<(cmd: object) => void>} */
const waiters = [];

let lastHello = null;
let connected = false;

function id() {
  return randomBytes(8).toString("hex");
}

export function extStatus() {
  return {
    connected,
    lastHello,
    pendingCommands: commandQueue.length,
    awaitingResults: pending.size,
  };
}

export function noteExtHello(payload = {}) {
  connected = true;
  lastHello = {
    at: new Date().toISOString(),
    ...payload,
  };
  return extStatus();
}

export function noteExtGone() {
  connected = false;
}

/**
 * Long-poll: wait for next command or timeout.
 */
export function takeExtCommand({ timeoutMs = 25000 } = {}) {
  connected = true;
  if (commandQueue.length) {
    return Promise.resolve(commandQueue.shift());
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const i = waiters.indexOf(wake);
      if (i >= 0) waiters.splice(i, 1);
      resolve(null);
    }, timeoutMs);
    function wake(cmd) {
      clearTimeout(timer);
      resolve(cmd);
    }
    waiters.push(wake);
  });
}

function enqueue(cmd) {
  if (waiters.length) {
    const wake = waiters.shift();
    wake(cmd);
  } else {
    commandQueue.push(cmd);
  }
}

/**
 * Send a command to the extension; wait for result.
 */
export function extRequest(type, payload = {}, { timeoutMs = 60000 } = {}) {
  const requestId = id();
  const cmd = { id: requestId, type, ...payload };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(
        new Error(
          `Extension did not respond to ${type} in ${timeoutMs}ms — is the mailnotmilk Chrome extension installed and Chrome open?`
        )
      );
    }, timeoutMs);
    pending.set(requestId, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
      timer,
    });
    enqueue(cmd);
  });
}

export function resolveExtResult(body = {}) {
  const { id: requestId, ok = true, data = null, error = null } = body;
  const entry = pending.get(requestId);
  if (!entry) return { ok: false, error: "unknown request id" };
  pending.delete(requestId);
  if (ok === false || error) entry.reject(new Error(error || "extension error"));
  else entry.resolve(data);
  return { ok: true };
}

export async function extListTabs() {
  return extRequest("list_tabs", {});
}

export async function extFocusTab({ tabId = null, urlIncludes = null, url = null } = {}) {
  return extRequest("focus_tab", { tabId, urlIncludes, url });
}

export async function extOpenUrl({ url } = {}) {
  return extRequest("open_url", { url });
}

export async function extExtract({ tabId = null, limit = 40 } = {}) {
  return extRequest("extract", { tabId, limit });
}

export async function extSend({ text, tabId = null, submit = true } = {}) {
  return extRequest("send", { text, tabId, submit });
}

export async function extEval({ tabId = null, code } = {}) {
  return extRequest("eval", { tabId, code });
}
