/**
 * First-class DeepSeek (Cursor) ↔ Claude Code bridging.
 *
 * Reality: nothing auto-launches Claude. You paste a prompt into Claude Code.
 * This module makes that paste the product.
 */

import { detectProvider, sanitizeId } from "./identity.js";
import {
  createChat,
  buildInviteBundle,
  postToChat,
  joinChat,
} from "./chats.js";

export function peerPastePrompt(chat, invite, { from, peer = "claude" } = {}) {
  const peerId = sanitizeId(peer);
  const fromId = sanitizeId(from || "deepseek");

  if (peerId === "claude" || peerId === "claude-code") {
    return [
      `You are Claude Code. Join a live collaboration chat with ${fromId} (running in Cursor).`,
      ``,
      `Do this now:`,
      `1. Call mailnotmilk MCP tool join_chat with invite_token="${invite.inviteToken}" and agent_id="claude"`,
      `2. Call chat_history with chat_id="${chat.id}"`,
      `3. Reply with chat_say (chat_id="${chat.id}") — keep talking in this chat`,
      `4. Before finishing a chunk, check_inbox or chat_history again`,
      ``,
      `Chat title: ${chat.title}`,
      `Chat id: ${chat.id}`,
      `Room: ${chat.room}`,
      `Hub (optional browser): ${invite.joinUrl}`,
      ``,
      `CLI fallback if MCP missing:`,
      `  mailnotmilk chat join ${invite.inviteToken} --agent claude`,
      `  mailnotmilk chat say ${chat.id} -t "hello from claude" --from claude`,
    ].join("\n");
  }

  return [
    `Join mailnotmilk chat "${chat.title}" (${chat.id}).`,
    `join_chat invite_token="${invite.inviteToken}" agent_id="${peerId}"`,
    `Then chat_say / chat_history on chat_id="${chat.id}"`,
    `Link: ${invite.joinUrl}`,
  ].join("\n");
}

/**
 * Open a bridge from the current agent (usually deepseek in Cursor) to Claude Code.
 * Returns everything the human needs to paste into Claude.
 */
export function openBridge({
  title = "DeepSeek ↔ Claude Code",
  from = null,
  peer = "claude",
  firstMessage = null,
  hubBase = null,
} = {}) {
  const fromId = sanitizeId(from || process.env.MAILNOTMILK_AGENT_ID || "deepseek");
  const peerId = sanitizeId(peer === "claude-code" ? "claude" : peer);

  const chat = createChat({
    title,
    createdBy: fromId,
    members: [peerId],
    meta: { bridge: { from: fromId, peer: peerId } },
  });

  // ensure peer roster slot exists even before they join
  joinChat({ chatId: chat.id, agentId: peerId, role: "invited" });

  const invite = buildInviteBundle(chat, { hubBase });
  const pasteForPeer = peerPastePrompt(chat, invite, { from: fromId, peer: peerId });

  let kickoff = null;
  if (firstMessage) {
    kickoff = postToChat({
      chatId: chat.id,
      from: fromId,
      text: firstMessage,
    });
  } else {
    kickoff = postToChat({
      chatId: chat.id,
      from: fromId,
      text: `Hey ${peerId} — I'm ${fromId}. Join this chat and let's collaborate.`,
    });
  }

  return {
    ok: true,
    goal: `${fromId} ↔ ${peerId}`,
    chat,
    invite,
    pasteForPeer,
    kickoff,
    instructionsForHuman: [
      "1. Keep this DeepSeek/Cursor chat open.",
      `2. Open Claude Code and paste everything under pasteForPeer.`,
      "3. Claude joins and replies in the same chat.",
      `4. Optional hub UI: ${invite.joinUrl}`,
      "Nothing auto-opens Claude — the paste is the bridge.",
    ].join("\n"),
  };
}

export function defaultBridgeFrom() {
  const detected = detectProvider();
  if (detected === "unknown" || detected === "cursor") {
    return process.env.MAILNOTMILK_AGENT_ID || "deepseek";
  }
  return detected;
}
