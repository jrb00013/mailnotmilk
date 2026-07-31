/**
 * Service worker: long-poll mailnotmilk hub, drive any tab.
 * User opens normal Chrome (shortcut). No --remote-debugging-port.
 */

const HUB =
  (typeof localStorage !== "undefined" && null) ||
  "http://127.0.0.1:7879";

let hubBase = HUB;
let preferredTabId = null;
let loopRunning = false;

chrome.storage.sync.get(["hubBase", "preferredTabId"], (v) => {
  if (v.hubBase) hubBase = v.hubBase;
  if (v.preferredTabId) preferredTabId = v.preferredTabId;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.hubBase) hubBase = changes.hubBase.newValue || HUB;
  if (changes.preferredTabId) preferredTabId = changes.preferredTabId.newValue;
});

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((t) => t.id != null && t.url && /^https?:/i.test(t.url))
    .map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: t.active,
      windowId: t.windowId,
    }));
}

async function resolveTabId({ tabId, urlIncludes, url } = {}) {
  if (tabId != null) return tabId;
  if (preferredTabId != null) {
    try {
      const t = await chrome.tabs.get(preferredTabId);
      if (t?.id != null) return t.id;
    } catch {
      /* stale */
    }
  }
  const tabs = await listTabs();
  if (url) {
    const hit = tabs.find((t) => t.url === url || t.url.startsWith(url));
    if (hit) return hit.id;
  }
  if (urlIncludes) {
    const re = new RegExp(urlIncludes, "i");
    const hit = tabs.find((t) => re.test(t.url));
    if (hit) return hit.id;
  }
  const active = tabs.find((t) => t.active);
  if (active) return active.id;
  if (tabs[0]) return tabs[0].id;
  throw new Error("No suitable browser tab found");
}

async function ensureContent(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
    return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }
}

async function tabMessage(tabId, msg) {
  await ensureContent(tabId);
  return chrome.tabs.sendMessage(tabId, msg);
}

async function handleCommand(cmd) {
  switch (cmd.type) {
    case "list_tabs":
      return listTabs();
    case "focus_tab": {
      const id = await resolveTabId(cmd);
      await chrome.tabs.update(id, { active: true });
      const tab = await chrome.tabs.get(id);
      preferredTabId = id;
      chrome.storage.sync.set({ preferredTabId: id });
      return { tabId: id, url: tab.url, title: tab.title };
    }
    case "open_url": {
      if (!cmd.url) throw new Error("url required");
      const tab = await chrome.tabs.create({ url: cmd.url, active: true });
      preferredTabId = tab.id;
      chrome.storage.sync.set({ preferredTabId: tab.id });
      // wait a bit for load
      await new Promise((r) => setTimeout(r, 1500));
      return { tabId: tab.id, url: cmd.url };
    }
    case "extract": {
      const id = await resolveTabId(cmd);
      const res = await tabMessage(id, { type: "extract", limit: cmd.limit });
      if (!res?.ok) throw new Error(res?.error || "extract failed");
      return { ...res.data, tabId: id };
    }
    case "send": {
      const id = await resolveTabId(cmd);
      const res = await tabMessage(id, {
        type: "send",
        text: cmd.text,
        submit: cmd.submit !== false,
      });
      if (!res?.ok) throw new Error(res?.error || "send failed");
      return { ...res.data, tabId: id };
    }
    case "eval": {
      const id = await resolveTabId(cmd);
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: "MAIN",
        func: (code) => {
          // eslint-disable-next-line no-eval
          return eval(code);
        },
        args: [cmd.code],
      });
      return result;
    }
    case "ping":
      return { pong: true, preferredTabId, hubBase };
    default:
      throw new Error(`unknown command ${cmd.type}`);
  }
}

async function hello() {
  const tabs = await listTabs();
  try {
    await fetch(`${hubBase}/api/ext/hello`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "mailnotmilk-extension",
        version: chrome.runtime.getManifest().version,
        tabCount: tabs.length,
        preferredTabId,
        tabs: tabs.slice(0, 30),
      }),
    });
  } catch {
    /* hub down */
  }
}

async function postResult(id, ok, data, error) {
  try {
    await fetch(`${hubBase}/api/ext/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ok, data, error }),
    });
  } catch {
    /* hub down */
  }
}

async function pollOnce() {
  let res;
  try {
    res = await fetch(`${hubBase}/api/ext/next?timeoutMs=20000`, {
      method: "GET",
    });
  } catch {
    return false;
  }
  if (!res.ok) return false;
  const body = await res.json().catch(() => null);
  if (!body || !body.command) return true; // hub up, idle
  const cmd = body.command;
  try {
    const data = await handleCommand(cmd);
    await postResult(cmd.id, true, data, null);
  } catch (err) {
    await postResult(cmd.id, false, null, err.message || String(err));
  }
  return true;
}

async function loop() {
  if (loopRunning) return;
  loopRunning = true;
  await hello();
  while (loopRunning) {
    try {
      const up = await pollOnce();
      if (!up) {
        await hello();
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

chrome.alarms.create("mailnotmilk-keep", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "mailnotmilk-keep") loop();
});

chrome.runtime.onInstalled.addListener(() => loop());
chrome.runtime.onStartup.addListener(() => loop());
loop();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "status") {
    sendResponse({ hubBase, preferredTabId, loopRunning });
    return;
  }
  if (msg?.type === "setHub") {
    hubBase = msg.hubBase || HUB;
    chrome.storage.sync.set({ hubBase });
    hello().then(() => sendResponse({ ok: true, hubBase }));
    return true;
  }
  if (msg?.type === "useActiveTab") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs[0];
      if (t?.id != null) {
        preferredTabId = t.id;
        chrome.storage.sync.set({ preferredTabId: t.id });
        sendResponse({ ok: true, tabId: t.id, url: t.url, title: t.title });
      } else sendResponse({ ok: false, error: "no active tab" });
    });
    return true;
  }
});
