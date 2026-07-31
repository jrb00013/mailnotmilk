import * as browser from "./browser.js";
import { openBridge } from "./bridge.js";
import {
  createChat,
  postToChat,
  chatMessages,
  getChat,
  buildInviteBundle,
} from "./chats.js";
import { sanitizeId } from "./identity.js";

function textOverlap(a, b, n = 80) {
  if (!a || !b) return false;
  const x = a.trim();
  const y = b.trim();
  if (!x || !y) return false;
  if (x === y) return true;
  const ax = x.slice(0, n);
  const ay = y.slice(0, n);
  return x.includes(ay) || y.includes(ax);
}

function alreadyPosted(history, fromId, marker, snippet) {
  return history.some(
    (m) =>
      m.from === fromId &&
      m.text.includes(marker) &&
      textOverlap(m.text, snippet, 80)
  );
}

/**
 * True when browser "user" text is just an echo of something we (or the peer)
 * already put into the chat / typed into the page.
 */
function isEchoOfOutbound(history, peerId, userText) {
  if (!userText) return false;
  for (const m of history) {
    if (m.from === "relay" && m.text.includes("## Relayed to browser")) continue;
    // Peer coding-agent messages we typed into ChatGPT
    if (m.from === peerId && m.type !== "system" && textOverlap(m.text, userText, 100)) {
      return true;
    }
    // Our own prior forwards of the same user blob
    if (
      m.from === "web-ai" ||
      (typeof m.from === "string" && m.text.includes("## From browser"))
    ) {
      if (textOverlap(m.text, userText, 100)) return true;
    }
  }
  return false;
}

/**
 * One relay cycle:
 * 1. Extract latest web AI user/assistant turns
 * 2. Forward NEW assistant replies (ChatGPT/etc.) into mailnotmilk — this is what peers need
 * 3. Forward NEW human user turns (skip echoes of peer→browser injects)
 * 4. Optionally wait for coding-agent reply and push into browser
 * 5. After inject, wait briefly for a new assistant turn and forward it
 */
export async function relayTick({
  chatId = null,
  site = "deepseek",
  peer = "claude",
  fromBrowser = "web-ai",
  waitPeerMs = 0,
  sendPeerReplyToBrowser = true,
  title = null,
  waitAssistantMs = 45_000,
} = {}) {
  const status = browser.browserStatus();
  if (!status.connected) {
    const ext = await import("./ext-bridge.js");
    if (ext.extStatus().connected || ext.extStatus().lastHello) {
      await browser.browserConnect({ mode: "extension" });
    } else {
      await browser.browserConnect({
        browser: "chrome",
        mode: "launch",
        headless: false,
      });
    }
    await browser.browserOpenAi({ site });
  } else if (!status.site || status.site === "custom") {
    await browser.browserOpenAi({ site });
  }

  let chat = chatId ? getChat(chatId) : null;
  let invite = null;
  if (!chat) {
    const bridge = openBridge({
      title: title || `Browser ${site} ↔ ${peer}`,
      from: fromBrowser,
      peer,
      firstMessage: `Relaying ${site} browser chat to ${peer}.`,
    });
    chat = bridge.chat;
    invite = { ...bridge.invite, pasteForPeer: bridge.pasteForPeer };
  }

  const fromId = sanitizeId(fromBrowser);
  const peerId = sanitizeId(peer === "claude-code" ? "claude" : peer);

  const extracted = await browser.browserExtractMessages({ limit: 50 });
  if (extracted.blocked === "cloudflare") {
    return {
      ok: false,
      error: extracted.error,
      chat,
      invite,
      extracted,
      forwarded: null,
      forwardedAssistant: null,
      peerReply: null,
      browserSend: null,
      browser: browser.browserStatus(),
    };
  }

  let lastUser = extracted.lastUser;
  let lastAssistant = extracted.lastAssistant;
  const history0 = chatMessages(chat.id, { limit: 50 });

  // 1) Forward ChatGPT (assistant) replies — the bug was dropping these
  let forwardedAssistant = null;
  if (lastAssistant?.text) {
    const marker = `## From browser (${site}) assistant`;
    if (!alreadyPosted(history0, fromId, marker, lastAssistant.text)) {
      forwardedAssistant = postToChat({
        chatId: chat.id,
        from: fromId,
        text: `${marker}\n\n${lastAssistant.text}`,
      });
    }
  }

  // 2) Forward human user turns — never echo peer→browser injects
  let forwarded = null;
  if (lastUser?.text) {
    const marker = `## From browser (${site}) user`;
    const echo = isEchoOfOutbound(history0, peerId, lastUser.text);
    const dup = alreadyPosted(history0, fromId, marker, lastUser.text);
    if (!echo && !dup) {
      forwarded = postToChat({
        chatId: chat.id,
        from: fromId,
        text: `${marker}\n\n${lastUser.text}`,
      });
    }
  }

  // 3) Wait for coding-agent reply
  let peerReply = null;
  let browserSend = null;
  const deadline = Date.now() + Math.max(0, Number(waitPeerMs) || 0);

  while (Date.now() <= deadline || waitPeerMs === 0) {
    const history = chatMessages(chat.id, { limit: 80 });
    const relayedIds = new Set(
      history
        .filter((m) => m.text.includes("## Relayed to browser (msg #"))
        .map((m) => {
          const match = m.text.match(/## Relayed to browser \(msg #(\d+)\)/);
          return match ? Number(match[1]) : null;
        })
        .filter(Boolean)
    );
    peerReply =
      [...history]
        .reverse()
        .find(
          (m) =>
            m.from === peerId &&
            m.type !== "system" &&
            !m.text.startsWith("## Relayed to browser") &&
            !relayedIds.has(m.id)
        ) || null;
    if (peerReply || waitPeerMs === 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // 4) Push peer reply into browser (once)
  if (sendPeerReplyToBrowser && peerReply) {
    const hist = chatMessages(chat.id, { limit: 80 });
    const marker = `## Relayed to browser`;
    const alreadySent = hist.some(
      (m) => m.text.includes(marker) && m.text.includes(String(peerReply.id))
    );
    if (!alreadySent) {
      const prevAssistant = lastAssistant?.text || null;
      browserSend = await browser.browserSendMessage({ text: peerReply.text });
      postToChat({
        chatId: chat.id,
        from: "relay",
        text: `${marker} (msg #${peerReply.id})`,
        type: "system",
      });

      // 5) Wait for a NEW assistant reply after inject, then forward it
      const assistDeadline = Date.now() + Math.max(0, Number(waitAssistantMs) || 0);
      while (Date.now() < assistDeadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const again = await browser.browserExtractMessages({ limit: 50 });
        if (again.blocked === "cloudflare") break;
        const a = again.lastAssistant;
        if (a?.text && a.text !== prevAssistant) {
          const hist2 = chatMessages(chat.id, { limit: 50 });
          const amarker = `## From browser (${site}) assistant`;
          if (!alreadyPosted(hist2, fromId, amarker, a.text)) {
            forwardedAssistant = postToChat({
              chatId: chat.id,
              from: fromId,
              text: `${amarker}\n\n${a.text}`,
            });
            lastAssistant = a;
          }
          break;
        }
      }
    }
  }

  return {
    ok: true,
    chat,
    invite,
    extracted: {
      count: extracted.count,
      lastUser: lastUser
        ? { role: lastUser.role, preview: lastUser.text.slice(0, 200) }
        : null,
      lastAssistant: lastAssistant
        ? { role: lastAssistant.role, preview: lastAssistant.text.slice(0, 200) }
        : null,
    },
    forwarded,
    forwardedAssistant,
    peerReply,
    browserSend,
    browser: browser.browserStatus(),
  };
}

export async function ensureChatForSite(site, peer, fromBrowser) {
  const chat = createChat({
    title: `Browser ${site} ↔ ${peer}`,
    createdBy: fromBrowser,
    members: [peer],
  });
  return { chat, invite: buildInviteBundle(chat, { from: fromBrowser, peer }) };
}
