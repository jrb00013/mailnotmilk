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

/**
 * Body of a previously posted "## From browser (…) role" message, minus the
 * marker line and any relay annotation, so it can be length-compared.
 */
export function postedBody(text, marker) {
  return text
    .split(marker)
    .pop()
    .replace(/\n\n_\(relay:[^\n]*\)_\s*$/, "")
    .trim();
}

export function alreadyPosted(history, fromId, marker, snippet) {
  const incoming = (snippet || "").trim();
  if (!incoming) return true;

  return history.some((m) => {
    if (m.from !== fromId || !m.text.includes(marker)) return false;
    if (!textOverlap(m.text, incoming, 80)) return false;

    // A partial and its finished version share a prefix, so prefix overlap
    // alone would let the truncated post suppress the complete one. Treat a
    // strictly longer continuation of what we already posted as new.
    const existing = postedBody(m.text, marker);
    if (incoming.length > existing.length && incoming.startsWith(existing.slice(0, 200))) {
      return false;
    }
    return true;
  });
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
  }

  // Follow the tab rather than the --site flag: whatever AI you navigate to is
  // the one we talk to. Only navigate when the current page is not a chat we
  // recognise, so we never yank the tab away from where you already are.
  const synced = await browser.syncSiteFromUrl();
  if (!synced.site || synced.site === "custom") {
    await browser.browserOpenAi({ site });
    await browser.syncSiteFromUrl();
  }
  site = browser.browserStatus().site || site;

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

  // 1) Forward assistant replies — the original bug was dropping these.
  // Skip while a turn is actively streaming: whatever is on screen right now
  // is a partial, and the next tick will pick it up once it settles.
  let forwardedAssistant = null;
  const generatingNow = await browser.browserIsGenerating();
  if (lastAssistant?.text && generatingNow !== true) {
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

      // 5) Wait for a COMPLETE new assistant reply, then forward it.
      // Forwarding on first-difference truncated mid-stream answers; the wait
      // now requires the text to settle before we post.
      const settledTurn = await browser.waitForAssistantTurn({
        prevText: prevAssistant,
        timeoutMs: Math.max(0, Number(waitAssistantMs) || 0),
      });

      if (settledTurn?.text) {
        const hist2 = chatMessages(chat.id, { limit: 50 });
        const amarker = `## From browser (${site}) assistant`;
        if (!alreadyPosted(hist2, fromId, amarker, settledTurn.text)) {
          // A capture that never settled is very likely a partial. Post it —
          // dropping a reply is worse — but label it so a truncated answer is
          // visible instead of silently passing as complete.
          const suffix = settledTurn.settled
            ? ""
            : `\n\n_(relay: capture did not settle — ${settledTurn.reason}; may be truncated)_`;
          forwardedAssistant = postToChat({
            chatId: chat.id,
            from: fromId,
            text: `${amarker}\n\n${settledTurn.text}${suffix}`,
          });
          lastAssistant = { role: "assistant", text: settledTurn.text };
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
