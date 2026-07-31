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

/**
 * One relay cycle:
 * 1. Extract latest web AI user/assistant turns
 * 2. Forward new user text into mailnotmilk chat for coding agent
 * 3. Optionally wait for coding-agent reply and push into browser
 */
export async function relayTick({
  chatId = null,
  site = "deepseek",
  peer = "claude",
  fromBrowser = "web-ai",
  waitPeerMs = 0,
  sendPeerReplyToBrowser = true,
  title = null,
} = {}) {
  const status = browser.browserStatus();
  if (!status.connected) {
    // Prefer extension (normal Chrome); else headed Playwright
    const ext = await import("./ext-bridge.js");
    if (ext.extStatus().connected || ext.extStatus().lastHello) {
      await browser.browserConnect({ mode: "extension" });
    } else {
      await browser.browserConnect({ browser: "chrome", mode: "launch", headless: false });
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

  const extracted = await browser.browserExtractMessages({ limit: 50 });
  if (extracted.blocked === "cloudflare") {
    return {
      ok: false,
      error: extracted.error,
      chat,
      invite,
      extracted,
      forwarded: null,
      peerReply: null,
      browserSend: null,
      browser: browser.browserStatus(),
    };
  }
  const lastUser = extracted.lastUser;
  const lastAssistant = extracted.lastAssistant;

  let forwarded = null;
  if (lastUser?.text) {
    const history = chatMessages(chat.id, { limit: 30 });
    const already = history.some(
      (m) => m.from === sanitizeId(fromBrowser) && m.text.includes(lastUser.text.slice(0, 80))
    );
    if (!already) {
      forwarded = postToChat({
        chatId: chat.id,
        from: fromBrowser,
        text: `## From browser (${site}) user\n\n${lastUser.text}`,
      });
    }
  }

  let peerReply = null;
  let browserSend = null;
  const deadline = Date.now() + Math.max(0, Number(waitPeerMs) || 0);
  const peerId = sanitizeId(peer === "claude-code" ? "claude" : peer);

  while (Date.now() <= deadline || waitPeerMs === 0) {
    const history = chatMessages(chat.id, { limit: 40 });
    peerReply =
      [...history].reverse().find((m) => m.from === peerId && m.type !== "system") ||
      null;
    if (peerReply || waitPeerMs === 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (sendPeerReplyToBrowser && peerReply) {
    const hist = chatMessages(chat.id, { limit: 80 });
    const marker = `## Relayed to browser`;
    const alreadySent = hist.some(
      (m) => m.text.includes(marker) && m.text.includes(String(peerReply.id))
    );
    if (!alreadySent) {
      browserSend = await browser.browserSendMessage({ text: peerReply.text });
      postToChat({
        chatId: chat.id,
        from: "relay",
        text: `${marker} (msg #${peerReply.id})`,
        type: "system",
      });
    }
  }

  return {
    ok: true,
    chat,
    invite,
    extracted: {
      count: extracted.count,
      lastUser: lastUser ? { role: lastUser.role, preview: lastUser.text.slice(0, 200) } : null,
      lastAssistant: lastAssistant
        ? { role: lastAssistant.role, preview: lastAssistant.text.slice(0, 200) }
        : null,
    },
    forwarded,
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
