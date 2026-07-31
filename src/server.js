import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { detectProvider } from "./identity.js";
import * as store from "./store.js";

export function createServer() {
  const server = new McpServer({ name: "mailnotmilk", version: "0.0.1" });
  server.tool("whoami", "Show auto-detected agent id", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify({ ok: true, agent_id: detectProvider() }) }],
  }));
  return server;
}
export async function startServer() {
  store.getDb();
  await createServer().connect(new StdioServerTransport());
}
