/**
 * Runs in every http(s) page. Extract / type into generic chat UIs.
 */
(() => {
  if (window.__mailnotmilkContent) return;
  window.__mailnotmilkContent = true;

  const COMPOSERS = [
    "#prompt-textarea",
    "textarea[data-id='root']",
    "div[contenteditable='true']#prompt-textarea",
    "form textarea",
    "rich-textarea div[contenteditable='true']",
    "div[contenteditable='true']",
    "textarea",
    "#chat-input",
    "#userInput",
    "p[data-placeholder]",
  ];

  const SENDERS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]',
    'button[aria-label*="Send"]',
    'button[type="submit"]',
    "button.send-button",
  ];

  const MSG_SELS = [
    "[data-message-author-role]",
    'article[data-testid^="conversation-turn"]',
    ".ds-message",
    "[data-test-render-count]",
    ".font-claude-message",
    "message-content",
    ".model-response-text",
    "[data-content='ai-message']",
    "[data-content='user-message']",
    "article",
    "[class*='message']",
  ];

  function firstEl(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function extract(limit = 40) {
    const out = [];
    const seen = new Set();
    const push = (role, text) => {
      const t = (text || "").trim();
      if (!t || t.length < 2) return;
      const key = `${role}:${t.slice(0, 160)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ role, text: t.slice(0, 8000) });
    };

    for (const sel of MSG_SELS) {
      for (const el of document.querySelectorAll(sel)) {
        let role = el.getAttribute("data-message-author-role");
        if (!role) {
          const named = el.querySelector?.("[data-message-author-role]");
          if (named) role = named.getAttribute("data-message-author-role");
        }
        if (!role) {
          const testid = (el.getAttribute("data-testid") || "").toLowerCase();
          const cls = (el.className || "").toString().toLowerCase();
          const dc = (el.getAttribute("data-content") || "").toLowerCase();
          if (
            testid.includes("user") ||
            cls.includes("user") ||
            cls.includes("human") ||
            dc.includes("user")
          )
            role = "user";
          else if (
            testid.includes("assistant") ||
            cls.includes("assistant") ||
            cls.includes("agent-turn") ||
            cls.includes("model") ||
            dc.includes("ai")
          )
            role = "assistant";
          else role = "unknown";
        }
        const body =
          el.querySelector?.(".markdown, .prose, [class*='markdown']") || el;
        push(role, body.innerText || body.textContent || "");
      }
      if (out.length) break;
    }

    if (!out.length) {
      for (const el of document.querySelectorAll("[data-message-author-role]")) {
        push(
          el.getAttribute("data-message-author-role") || "unknown",
          el.innerText || el.textContent || ""
        );
      }
    }

    const messages = out.slice(-Math.min(Math.max(Number(limit) || 40, 1), 100));
    return {
      url: location.href,
      title: document.title,
      count: messages.length,
      messages,
      lastAssistant:
        [...messages].reverse().find((m) => m.role === "assistant") || null,
      lastUser: [...messages].reverse().find((m) => m.role === "user") || null,
    };
  }

  async function send(text, submit = true) {
    const composer = firstEl(COMPOSERS);
    if (!composer) throw new Error("Could not find chat composer on this page");
    composer.focus();
    composer.click();

    const tag = composer.tagName.toLowerCase();
    if (tag === "textarea" || tag === "input") {
      composer.value = text;
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // contenteditable
      composer.textContent = "";
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    }

    if (submit) {
      const btn = firstEl(SENDERS);
      if (btn) btn.click();
      else {
        composer.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
            cancelable: true,
          })
        );
      }
    }
    return { ok: true, url: location.href };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg?.type === "ping") {
          sendResponse({ ok: true, url: location.href, title: document.title });
          return;
        }
        if (msg?.type === "extract") {
          sendResponse({ ok: true, data: extract(msg.limit) });
          return;
        }
        if (msg?.type === "send") {
          const data = await send(msg.text, msg.submit !== false);
          sendResponse({ ok: true, data });
          return;
        }
        if (msg?.type === "eval") {
          // eslint-disable-next-line no-eval
          const data = await eval(msg.code);
          sendResponse({ ok: true, data });
          return;
        }
        sendResponse({ ok: false, error: "unknown content command" });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  });
})();
