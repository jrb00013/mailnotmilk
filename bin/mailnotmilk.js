#!/usr/bin/env node
import { program } from "commander";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require(join(__dirname, "../package.json"));

program
  .name("mailnotmilk")
  .description(pkg.description)
  .version(pkg.version);

program
  .command("serve")
  .description("Start the MCP server (stdio — used by AI tools)")
  .action(async () => {
    const { startServer } = await import("../src/server.js");
    await startServer();
  });

program
  .command("install")
  .description("Auto-configure AI tools to use this MCP server")
  .option("--all", "Install for all supported tools")
  .option(
    "--tool <tool>",
    "Install for a specific tool (claude-code, cursor, windsurf, …)"
  )
  .action(async (opts) => {
    const { install, AVAILABLE_TOOLS } = await import("../src/install.js");
    if (!opts.all && !opts.tool) {
      console.log("Supported tools:", AVAILABLE_TOOLS.join(", "));
      console.log("Use --all to install for all, or --tool <name> for one.");
      process.exit(1);
    }
    await install(opts.all ? "all" : opts.tool);
  });

program
  .command("whoami")
  .description("Print detected agent id")
  .action(async () => {
    const { detectProvider } = await import("../src/identity.js");
    console.log(detectProvider());
  });

program
  .command("send")
  .description("CLI: post a message into the mailbox")
  .requiredOption("-t, --text <text>", "Message body")
  .option("-f, --from <id>", "Sender id (default: auto-detect)")
  .option("--to <id>", "Recipient agent id")
  .option("-r, --room <room>", "Room", "general")
  .action(async (opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const store = await import("../src/store.js");
    const msg = store.postMessage({
      from: opts.from || detectProvider(),
      to: opts.to || null,
      room: opts.room,
      text: opts.text,
    });
    console.log(JSON.stringify(msg, null, 2));
  });

program
  .command("inbox")
  .description("CLI: list unread messages")
  .option("-a, --agent <id>", "Agent id (default: auto-detect)")
  .option("-n, --limit <n>", "Max results", "20")
  .option("--read", "Mark returned messages as read")
  .action(async (opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const store = await import("../src/store.js");
    const id = opts.agent || detectProvider();
    const messages = store.checkInbox(id, { limit: Number(opts.limit) });
    if (opts.read) {
      for (const m of messages) store.readMessage(id, m.id);
    }
    console.log(JSON.stringify({ agent_id: id, messages }, null, 2));
  });

program
  .command("agents")
  .description("CLI: list recent agents")
  .action(async () => {
    const store = await import("../src/store.js");
    console.log(JSON.stringify(store.listAgents(), null, 2));
  });

program
  .command("status")
  .description("CLI: get or set agent status")
  .argument("[agent]", "Agent id")
  .option("-s, --set <status>", "idle | working | waiting")
  .action(async (agent, opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const store = await import("../src/store.js");
    const id = agent || detectProvider();
    if (opts.set) {
      console.log(JSON.stringify(store.setStatus(id, opts.set), null, 2));
    } else {
      console.log(JSON.stringify(store.getStatus(id), null, 2));
    }
  });

program.parse();
