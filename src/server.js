import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { detectProvider, sanitizeId } from "./identity.js";
import { summarizeEnvelope } from "./envelope.js";
import * as store from "./store.js";

function textResult(obj) {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text: body }] };
}

function resolveAgentId(explicit) {
  if (explicit) return sanitizeId(explicit);
  return detectProvider();
}

export function createServer() {
  const server = new McpServer({
    name: "mailnotmilk",
    version: "1.0.0",
  });

  server.tool(
    "register_agent",
    "Register or refresh this agent's identity in the shared mailbox roster.",
    {
      id: z
        .string()
        .optional()
        .describe("Agent id (default: auto-detect cursor/claude/…)"),
      display_name: z.string().optional().describe("Human-readable name"),
      role: z.string().optional().describe("Short role label"),
      status: z
        .enum(["idle", "working", "waiting"])
        .optional()
        .describe("Presence status"),
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
    "Send a markdown message to another agent (DM) or omit `to` to broadcast to a room.",
    {
      text: z.string().describe("Message body (markdown ok)"),
      to: z
        .string()
        .optional()
        .describe("Recipient agent id; omit for room broadcast"),
      room: z.string().optional().describe("Room name (default: general)"),
      from: z.string().optional().describe("Sender id (default: auto-detect)"),
    },
    async ({ text, to, room, from }) => {
      const msg = store.postMessage({
        from: resolveAgentId(from),
        to: to || null,
        room: room || "general",
        text,
      });
      return textResult({
        ok: true,
        message: msg,
        summary: summarizeEnvelope(msg),
      });
    }
  );

  server.tool(
    "check_inbox",
    "List unread messages for an agent (DMs + room broadcasts). Optionally wait briefly for new mail.",
    {
      agent_id: z.string().optional().describe("Who is checking (default: auto-detect)"),
      limit: z.number().int().min(1).max(100).optional().describe("Max messages"),
      room: z.string().optional().describe("Filter to one room"),
      wait_ms: z
        .number()
        .int()
        .min(0)
        .max(30_000)
        .optional()
        .describe("Short poll wait in ms (default 0)"),
    },
    async ({ agent_id, limit, room, wait_ms }) => {
      const id = resolveAgentId(agent_id);
      const messages = await store.checkInboxWait(id, {
        limit: limit || 20,
        room: room || null,
        waitMs: wait_ms || 0,
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
    "Fetch a message body and mark it read (ack) for this agent.",
    {
      message_id: z.number().int().describe("Message id from check_inbox"),
      agent_id: z.string().optional().describe("Reader id (default: auto-detect)"),
    },
    async ({ message_id, agent_id }) => {
      const msg = store.readMessage(resolveAgentId(agent_id), message_id);
      return textResult({ ok: true, message: msg });
    }
  );

  server.tool(
    "reply_message",
    "Reply to a message; routes back to the original sender in the same room.",
    {
      message_id: z.number().int().describe("Parent message id"),
      text: z.string().describe("Reply body"),
      from: z.string().optional().describe("Sender id (default: auto-detect)"),
    },
    async ({ message_id, text, from }) => {
      const msg = store.replyMessage({
        from: resolveAgentId(from),
        inReplyTo: message_id,
        text,
      });
      return textResult({
        ok: true,
        message: msg,
        summary: summarizeEnvelope(msg),
      });
    }
  );

  server.tool(
    "list_agents",
    "List agents seen recently on the mailbox roster.",
    {
      since_minutes: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Lookback window in minutes (default 1440)"),
    },
    async ({ since_minutes }) => {
      const agents = store.listAgents({
        sinceMinutes: since_minutes || 60 * 24,
      });
      return textResult({ ok: true, agents });
    }
  );

  server.tool(
    "set_status",
    "Set this agent's presence: idle | working | waiting.",
    {
      status: z.enum(["idle", "working", "waiting"]),
      agent_id: z.string().optional(),
    },
    async ({ status, agent_id }) => {
      const agent = store.setStatus(resolveAgentId(agent_id), status);
      return textResult({ ok: true, agent });
    }
  );

  server.tool(
    "get_status",
    "Get presence for an agent id.",
    {
      agent_id: z.string().describe("Agent to look up"),
    },
    async ({ agent_id }) => {
      const status = store.getStatus(sanitizeId(agent_id));
      return textResult({
        ok: Boolean(status),
        status: status || null,
      });
    }
  );

  server.tool(
    "whoami",
    "Show the auto-detected agent id for this MCP process.",
    {},
    async () => {
      const id = detectProvider();
      return textResult({ ok: true, agent_id: id });
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
