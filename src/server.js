import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { detectProvider, sanitizeId } from "./identity.js";
import { summarizeEnvelope } from "./envelope.js";
import { renderBoard } from "./board.js";
import { postTurn } from "./turn.js";
import * as store from "./store.js";

function textResult(obj) {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text: body }] };
}

function resolveAgentId(explicit) {
  if (explicit) return sanitizeId(explicit);
  return detectProvider();
}

const priorityZ = z.enum(["low", "normal", "high", "urgent"]).optional();

export function createServer() {
  const server = new McpServer({
    name: "mailnotmilk",
    version: "1.5.0",
  });

  server.tool(
    "whoami",
    "Show the auto-detected agent id for this MCP process.",
    {},
    async () => textResult({ ok: true, agent_id: detectProvider() })
  );

  server.tool(
    "register_agent",
    "Register or refresh this agent's identity in the shared mailbox roster.",
    {
      id: z.string().optional(),
      display_name: z.string().optional(),
      role: z.string().optional(),
      status: z.enum(["idle", "working", "waiting"]).optional(),
    },
    async ({ id, display_name, role, status }) => {
      const agent = store.registerAgent({
        id: resolveAgentId(id),
        displayName: display_name,
        role,
        status: status || "idle",
      });
      return textResult({ ok: true, agent });
    }
  );

  server.tool(
    "post_message",
    "Send markdown to an agent (DM) or omit `to` for room broadcast. Supports @mentions, priority, tags, file path attachments.",
    {
      text: z.string(),
      to: z.string().optional(),
      room: z.string().optional(),
      from: z.string().optional(),
      priority: priorityZ,
      tags: z.array(z.string()).optional(),
      attachments: z
        .array(z.object({ type: z.string(), path: z.string().optional(), url: z.string().optional() }))
        .optional(),
    },
    async ({ text, to, room, from, priority, tags, attachments }) => {
      const msg = store.postMessage({
        from: resolveAgentId(from),
        to: to || null,
        room: room || "general",
        text,
        priority: priority || "normal",
        tags: tags || [],
        attachments: attachments || [],
      });
      return textResult({ ok: true, message: msg, summary: summarizeEnvelope(msg) });
    }
  );

  server.tool(
    "post_handoff",
    "Send a structured task handoff (title, objective, acceptance, files) to another agent.",
    {
      to: z.string().describe("Target agent id"),
      title: z.string(),
      objective: z.string(),
      context: z.string().optional(),
      acceptance: z.array(z.string()).optional(),
      files: z.array(z.string()).optional(),
      room: z.string().optional(),
      priority: priorityZ,
      from: z.string().optional(),
    },
    async (args) => {
      const msg = store.postHandoff({
        from: resolveAgentId(args.from),
        to: args.to,
        title: args.title,
        objective: args.objective,
        context: args.context || "",
        acceptance: args.acceptance || [],
        files: args.files || [],
        room: args.room || "general",
        priority: args.priority || "high",
      });
      return textResult({ ok: true, message: msg, summary: summarizeEnvelope(msg) });
    }
  );

  server.tool(
    "post_turn",
    "Announce what this agent just finished so peers stay in sync (end-of-turn summary).",
    {
      summary: z.string(),
      to: z.string().optional(),
      room: z.string().optional(),
      files: z.array(z.string()).optional(),
      outcome: z.enum(["progress", "blocked", "done"]).optional(),
      from: z.string().optional(),
    },
    async ({ summary, to, room, files, outcome, from }) => {
      const msg = postTurn({
        from: resolveAgentId(from),
        to: to || null,
        room: room || "general",
        summary,
        files: files || [],
        outcome: outcome || "progress",
      });
      return textResult({ ok: true, message: msg, summary: summarizeEnvelope(msg) });
    }
  );

  server.tool(
    "check_inbox",
    "List unread messages (DMs, broadcasts, @mentions). Priority-sorted. Optional short wait.",
    {
      agent_id: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      room: z.string().optional(),
      wait_ms: z.number().int().min(0).max(30_000).optional(),
      priority: priorityZ,
    },
    async ({ agent_id, limit, room, wait_ms, priority }) => {
      const id = resolveAgentId(agent_id);
      const messages = await store.checkInboxWait(id, {
        limit: limit || 20,
        room: room || null,
        waitMs: wait_ms || 0,
        priority: priority || null,
      });
      return textResult({
        ok: true,
        agent_id: id,
        count: messages.length,
        messages,
        summaries: messages.map(summarizeEnvelope),
      });
    }
  );

  server.tool(
    "read_message",
    "Fetch a message and mark it read (ack).",
    {
      message_id: z.number().int(),
      agent_id: z.string().optional(),
    },
    async ({ message_id, agent_id }) => {
      const msg = store.readMessage(resolveAgentId(agent_id), message_id);
      return textResult({ ok: true, message: msg });
    }
  );

  server.tool(
    "mark_unread",
    "Remove the read receipt so a message shows up in inbox again.",
    {
      message_id: z.number().int(),
      agent_id: z.string().optional(),
    },
    async ({ message_id, agent_id }) => {
      const msg = store.markUnread(resolveAgentId(agent_id), message_id);
      return textResult({ ok: true, message: msg });
    }
  );

  server.tool(
    "reply_message",
    "Reply in-thread; routes back to the original sender.",
    {
      message_id: z.number().int(),
      text: z.string(),
      from: z.string().optional(),
      priority: priorityZ,
    },
    async ({ message_id, text, from, priority }) => {
      const msg = store.replyMessage({
        from: resolveAgentId(from),
        inReplyTo: message_id,
        text,
        priority: priority || "normal",
      });
      return textResult({ ok: true, message: msg, summary: summarizeEnvelope(msg) });
    }
  );

  server.tool(
    "get_thread",
    "Fetch the full conversation thread for a message id.",
    {
      message_id: z.number().int(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    async ({ message_id, limit }) => {
      const messages = store.getThread(message_id, { limit: limit || 100 });
      return textResult({ ok: true, count: messages.length, messages });
    }
  );

  server.tool(
    "search_messages",
    "Full-text search over message bodies.",
    {
      query: z.string(),
      room: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async ({ query, room, from, to, limit }) => {
      const messages = store.searchMessages({
        query,
        room,
        from,
        to,
        limit: limit || 50,
      });
      return textResult({ ok: true, count: messages.length, messages });
    }
  );

  server.tool(
    "list_history",
    "Recent messages (read or unread) for an agent or room.",
    {
      agent_id: z.string().optional(),
      room: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async ({ agent_id, room, limit }) => {
      const messages = store.listHistory({
        agentId: agent_id ? resolveAgentId(agent_id) : null,
        room: room || null,
        limit: limit || 50,
      });
      return textResult({ ok: true, count: messages.length, messages });
    }
  );

  server.tool(
    "archive_message",
    "Archive a message (hides from default inbox/history).",
    { message_id: z.number().int() },
    async ({ message_id }) =>
      textResult({ ok: true, message: store.archiveMessage(message_id) })
  );

  server.tool(
    "react_message",
    "Add an emoji reaction to a message.",
    {
      message_id: z.number().int(),
      emoji: z.string(),
      agent_id: z.string().optional(),
    },
    async ({ message_id, emoji, agent_id }) => {
      const reactions = store.react(message_id, resolveAgentId(agent_id), emoji);
      return textResult({ ok: true, reactions });
    }
  );

  server.tool(
    "list_agents",
    "List agents seen recently on the roster.",
    {
      since_minutes: z.number().int().min(1).optional(),
    },
    async ({ since_minutes }) =>
      textResult({
        ok: true,
        agents: store.listAgents({ sinceMinutes: since_minutes || 60 * 24 }),
      })
  );

  server.tool(
    "list_rooms",
    "List active rooms with message counts.",
    {},
    async () => textResult({ ok: true, rooms: store.listRooms() })
  );

  server.tool(
    "subscribe_room",
    "Remember interest in a room (roster metadata).",
    {
      room: z.string(),
      agent_id: z.string().optional(),
    },
    async ({ room, agent_id }) =>
      textResult({
        ok: true,
        subscriptions: store.subscribeRoom(resolveAgentId(agent_id), room),
      })
  );

  server.tool(
    "set_status",
    "Set presence: idle | working | waiting.",
    {
      status: z.enum(["idle", "working", "waiting"]),
      agent_id: z.string().optional(),
    },
    async ({ status, agent_id }) =>
      textResult({ ok: true, agent: store.setStatus(resolveAgentId(agent_id), status) })
  );

  server.tool(
    "get_status",
    "Get presence for an agent id.",
    { agent_id: z.string() },
    async ({ agent_id }) => {
      const status = store.getStatus(sanitizeId(agent_id));
      return textResult({ ok: Boolean(status), status: status || null });
    }
  );

  server.tool(
    "mailbox_stats",
    "Aggregate mailbox stats (counts, priorities, live agents).",
    {},
    async () => textResult({ ok: true, stats: store.stats() })
  );

  server.tool(
    "mailbox_board",
    "Human-readable status board: agents, rooms, urgent, recent.",
    {},
    async () => textResult(renderBoard())
  );

  server.tool(
    "create_chat",
    "Create a shared chat session and return a join link + peer prompt to paste into Claude/Cursor. (Mail does NOT auto-open the other app.)",
    {
      title: z.string().describe("Short chat title"),
      created_by: z.string().optional(),
      members: z.array(z.string()).optional(),
      peer: z
        .string()
        .optional()
        .describe("Who will receive the paste prompt (default claude)"),
    },
    async ({ title, created_by, members, peer }) => {
      const chats = await import("./chats.js");
      const from = resolveAgentId(created_by);
      const chat = chats.createChat({
        title,
        createdBy: from,
        members: members || [],
      });
      const invite = chats.buildInviteBundle(chat, {
        from,
        peer: peer || "claude",
      });
      return textResult({ ok: true, chat, invite });
    }
  );

  server.tool(
    "bridge_to_claude",
    "DeepSeek/Cursor → Claude Code bridge. Creates a chat and returns pasteForPeer — the human pastes that into Claude Code. Nothing auto-opens Claude.",
    {
      title: z.string().optional().describe("Chat title"),
      message: z
        .string()
        .optional()
        .describe("First message from you (DeepSeek) into the chat"),
      from: z
        .string()
        .optional()
        .describe("Your id (default deepseek)"),
    },
    async ({ title, message, from }) => {
      const { openBridge, defaultBridgeFrom } = await import("./bridge.js");
      const result = openBridge({
        title: title || "DeepSeek ↔ Claude Code",
        from: from || defaultBridgeFrom(),
        peer: "claude",
        firstMessage: message || null,
      });
      return textResult({
        ok: true,
        ...result,
        human_action:
          "Show pasteForPeer to the user and tell them to paste it into Claude Code.",
      });
    }
  );

  server.tool(
    "join_chat",
    "Join a chat via invite_token (from a shared link/prompt).",
    {
      invite_token: z.string(),
      agent_id: z.string().optional(),
    },
    async ({ invite_token, agent_id }) => {
      const chats = await import("./chats.js");
      const result = chats.joinByInvite({
        token: invite_token,
        agentId: resolveAgentId(agent_id),
      });
      return textResult({
        ok: true,
        ...result,
        invite: chats.buildInviteBundle(result.chat),
      });
    }
  );

  server.tool(
    "chat_link",
    "Get the shareable join URL + peer prompt for a chat id.",
    { chat_id: z.string() },
    async ({ chat_id }) => {
      const chats = await import("./chats.js");
      const chat = chats.getChat(chat_id);
      if (!chat) return textResult({ ok: false, error: "chat not found" });
      return textResult({ ok: true, invite: chats.buildInviteBundle(chat) });
    }
  );

  server.tool(
    "chat_say",
    "Post a message into a chat room (by chat id).",
    {
      chat_id: z.string(),
      text: z.string(),
      from: z.string().optional(),
      to: z.string().optional(),
    },
    async ({ chat_id, text, from, to }) => {
      const chats = await import("./chats.js");
      const msg = chats.postToChat({
        chatId: chat_id,
        from: resolveAgentId(from),
        text,
        to: to || null,
      });
      return textResult({ ok: true, message: msg, summary: summarizeEnvelope(msg) });
    }
  );

  server.tool(
    "chat_history",
    "List messages in a chat (chronological).",
    {
      chat_id: z.string(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    async ({ chat_id, limit }) => {
      const chats = await import("./chats.js");
      const messages = chats.chatMessages(chat_id, { limit: limit || 100 });
      return textResult({ ok: true, count: messages.length, messages });
    }
  );

  server.tool(
    "list_chats",
    "List recent chat sessions.",
    { limit: z.number().int().min(1).max(200).optional() },
    async ({ limit }) => {
      const chats = await import("./chats.js");
      return textResult({ ok: true, chats: chats.listChats({ limit: limit || 50 }) });
    }
  );

  server.tool(
    "browser_connect",
    "Attach to the user's Chrome via CDP (preferred) or launch Playwright. Never asks the user to log in — auth is optional; drive whatever page/session is open.",
    {
      browser: z.enum(["chrome", "firefox"]).optional(),
      mode: z.enum(["launch", "cdp"]).optional(),
      cdp_url: z.string().optional().describe("For mode=cdp, e.g. http://127.0.0.1:9222"),
      headless: z
        .boolean()
        .optional()
        .describe("Only for mode=launch. Default true. Login not required either way."),
    },
    async ({ browser, mode, cdp_url, headless }) => {
      const b = await import("./browser.js");
      let resolvedMode = mode || "launch";
      let cdpUrl = cdp_url || "http://127.0.0.1:9222";
      if (!mode && (browser || "chrome") !== "firefox") {
        const { ensureChromeCdp } = await import("./chrome-session.js");
        const sess = await ensureChromeCdp({ cdpUrl, startIfMissing: true });
        if (sess.ok) resolvedMode = "cdp";
      }
      const status = await b.browserConnect({
        browser: browser || "chrome",
        mode: resolvedMode,
        cdpUrl,
        headless: headless === undefined ? true : Boolean(headless),
      });
      return textResult({ ok: true, status, mode: resolvedMode });
    }
  );

  server.tool(
    "browser_open_ai",
    "Navigate the connected browser to ChatGPT, DeepSeek, Claude, Gemini, Copilot, or a custom URL.",
    {
      site: z
        .enum(["chatgpt", "deepseek", "claude", "gemini", "copilot"])
        .optional(),
      url: z.string().optional(),
    },
    async ({ site, url }) => {
      const b = await import("./browser.js");
      const status = await b.browserOpenAi({ site: site || "deepseek", url: url || null });
      return textResult({ ok: true, status });
    }
  );

  server.tool(
    "browser_extract_messages",
    "Parse visible chat turns from the open browser AI page.",
    { limit: z.number().int().min(1).max(100).optional() },
    async ({ limit }) => {
      const b = await import("./browser.js");
      return textResult({ ok: true, ...(await b.browserExtractMessages({ limit: limit || 40 })) });
    }
  );

  server.tool(
    "browser_send_message",
    "Type a message into the browser AI composer and send it.",
    {
      text: z.string(),
      submit: z.boolean().optional(),
    },
    async ({ text, submit }) => {
      const b = await import("./browser.js");
      return textResult({
        ok: true,
        ...(await b.browserSendMessage({ text, submit: submit !== false })),
      });
    }
  );

  server.tool(
    "browser_screenshot",
    "Screenshot the current browser page.",
    { path: z.string().optional() },
    async ({ path }) => {
      const b = await import("./browser.js");
      return textResult({ ok: true, ...(await b.browserScreenshot({ path: path || null })) });
    }
  );

  server.tool(
    "browser_disconnect",
    "Close the Playwright browser session.",
    {},
    async () => {
      const b = await import("./browser.js");
      return textResult(await b.browserDisconnect());
    }
  );

  server.tool(
    "browser_status",
    "Show whether a browser session is connected and which site is open.",
    {},
    async () => {
      const b = await import("./browser.js");
      return textResult({ ok: true, status: b.browserStatus(), sites: b.listSites() });
    }
  );

  server.tool(
    "relay_tick",
    "One relay cycle: extract browser AI messages → mailnotmilk chat → optional wait for coding-agent reply → send back to browser.",
    {
      site: z.enum(["chatgpt", "deepseek", "claude", "gemini", "copilot"]).optional(),
      peer: z.string().optional().describe("Coding agent id (default claude)"),
      chat_id: z.string().optional(),
      wait_peer_ms: z.number().int().min(0).max(120_000).optional(),
      title: z.string().optional(),
    },
    async ({ site, peer, chat_id, wait_peer_ms, title }) => {
      const { relayTick } = await import("./relay.js");
      const result = await relayTick({
        site: site || "deepseek",
        peer: peer || "claude",
        chatId: chat_id || null,
        waitPeerMs: wait_peer_ms || 0,
        title: title || null,
      });
      return textResult({
        ok: true,
        ...result,
        human_action: result.invite?.pasteForPeer
          ? "If peer has not joined yet, paste invite.pasteForPeer / pasteForPeer into Claude Code / Cursor / OpenCode."
          : undefined,
      });
    }
  );

  return server;
}

export async function startServer() {
  store.getDb();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
