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
  .option("--tool <tool>", "Install for a specific tool")
  .option("--hooks", "Also install turn-hook helpers")
  .action(async (opts) => {
    const { install, AVAILABLE_TOOLS } = await import("../src/install.js");
    if (!opts.all && !opts.tool) {
      console.log("Supported tools:", AVAILABLE_TOOLS.join(", "));
      console.log("Use --all to install for all, or --tool <name> for one.");
      process.exit(1);
    }
    await install(opts.all ? "all" : opts.tool);
    if (opts.hooks) {
      const turn = await import("../src/turn.js");
      console.log(turn.installCursorHooks(process.cwd()));
      console.log(turn.installClaudeStopHint());
    }
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
  .description("Post raw mail (does NOT open Claude/Cursor — prefer: chat new)")
  .requiredOption("-t, --text <text>", "Message body")
  .option("-f, --from <id>", "Sender id")
  .option("--to <id>", "Recipient agent id")
  .option("-r, --room <room>", "Room", "general")
  .option("-p, --priority <p>", "low|normal|high|urgent", "normal")
  .action(async (opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const store = await import("../src/store.js");
    const msg = store.postMessage({
      from: opts.from || detectProvider(),
      to: opts.to || null,
      room: opts.room,
      text: opts.text,
      priority: opts.priority,
    });
    console.error(
      "note: this only writes to the local mailbox — it will not pop open Claude/Cursor.\nprefer: mailnotmilk chat new -t \"…\"   then share the join link / peer prompt"
    );
    console.log(JSON.stringify(msg, null, 2));
  });

const chat = program.command("chat").description("Chat sessions with shareable join links");

chat
  .command("new")
  .description("Create a chat and print join link + peer prompt")
  .option("-t, --title <title>", "Chat title", "Untitled chat")
  .option("-f, --from <id>", "Creator id")
  .option("--member <id>", "Invite member (repeatable)", (v, a) => [...a, v], [])
  .option("--open", "Open hub page in browser")
  .action(async (opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const chats = await import("../src/chats.js");
    const chatObj = chats.createChat({
      title: opts.title,
      createdBy: opts.from || detectProvider(),
      members: opts.member || [],
    });
    const invite = chats.buildInviteBundle(chatObj);
    console.log(JSON.stringify({ chat: chatObj, invite }, null, 2));
    console.error("\n—— share this with the other agent ——\n");
    console.error(invite.peerPrompt);
    console.error(`\nHub: ${invite.joinUrl}`);
    if (opts.open) {
      const { openUrl } = await import("../src/open.js");
      await openUrl(invite.joinUrl);
    }
  });

chat
  .command("link")
  .description("Print join link / peer prompt for a chat")
  .argument("<id>", "Chat id")
  .action(async (id) => {
    const chats = await import("../src/chats.js");
    const chatObj = chats.getChat(id);
    if (!chatObj) {
      console.error("chat not found");
      process.exit(1);
    }
    const invite = chats.buildInviteBundle(chatObj);
    console.log(JSON.stringify(invite, null, 2));
    console.error("\n" + invite.peerPrompt);
  });

chat
  .command("join")
  .description("Join via invite token")
  .argument("<token>", "Invite token")
  .option("-a, --agent <id>", "Your agent id")
  .action(async (token, opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const chats = await import("../src/chats.js");
    const result = chats.joinByInvite({
      token,
      agentId: opts.agent || detectProvider(),
    });
    console.log(
      JSON.stringify(
        { ...result, invite: chats.buildInviteBundle(result.chat) },
        null,
        2
      )
    );
  });

chat
  .command("say")
  .description("Post into a chat")
  .argument("<id>", "Chat id")
  .requiredOption("-t, --text <text>", "Message")
  .option("-f, --from <id>")
  .option("--to <id>")
  .action(async (id, opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const chats = await import("../src/chats.js");
    const msg = chats.postToChat({
      chatId: id,
      from: opts.from || detectProvider(),
      text: opts.text,
      to: opts.to || null,
    });
    console.log(JSON.stringify(msg, null, 2));
  });

chat
  .command("log")
  .description("Show chat messages")
  .argument("<id>", "Chat id")
  .option("-n, --limit <n>", "100")
  .action(async (id, opts) => {
    const chats = await import("../src/chats.js");
    console.log(
      JSON.stringify(chats.chatMessages(id, { limit: Number(opts.limit) }), null, 2)
    );
  });

chat
  .command("ls")
  .description("List chats")
  .action(async () => {
    const chats = await import("../src/chats.js");
    console.log(JSON.stringify(chats.listChats(), null, 2));
  });

chat
  .command("open")
  .description("Open chat in local hub (starts hub if needed)")
  .argument("[id]", "Chat id (optional — opens hub home)")
  .option("-p, --port <n>", "Hub port", "7879")
  .action(async (id, opts) => {
    const port = Number(opts.port);
    const { ensureHub } = await import("../src/open.js");
    const base = await ensureHub(port);
    const { openUrl } = await import("../src/open.js");
    const url = id ? `${base}/c/${id}` : base;
    console.error(url);
    await openUrl(url);
  });

program
  .command("hub")
  .description("Run local HTTP chat hub (shareable links live here)")
  .option("-p, --port <n>", "Port", "7879")
  .action(async (opts) => {
    const { startHub } = await import("../src/hub.js");
    const { url } = await startHub({ port: Number(opts.port) });
    console.log(url);
    await new Promise(() => {});
  });

program
  .command("handoff")
  .description("Post a structured handoff")
  .requiredOption("--to <id>", "Target agent")
  .requiredOption("--title <title>", "Handoff title")
  .requiredOption("--objective <text>", "What to do")
  .option("--context <text>", "Extra context")
  .option("--file <path>", "Related file (repeatable)", (v, a) => [...a, v], [])
  .option("--accept <item>", "Acceptance criterion (repeatable)", (v, a) => [...a, v], [])
  .option("-r, --room <room>", "Room", "general")
  .option("-f, --from <id>", "Sender")
  .action(async (opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const store = await import("../src/store.js");
    const msg = store.postHandoff({
      from: opts.from || detectProvider(),
      to: opts.to,
      title: opts.title,
      objective: opts.objective,
      context: opts.context || "",
      files: opts.file || [],
      acceptance: opts.accept || [],
      room: opts.room,
    });
    console.log(JSON.stringify(msg, null, 2));
  });

program
  .command("turn")
  .description("Post an end-of-turn summary")
  .requiredOption("-t, --text <summary>", "What you did")
  .option("--to <id>", "Notify agent")
  .option("-r, --room <room>", "Room", "general")
  .option("--outcome <o>", "progress|blocked|done", "progress")
  .option("-f, --from <id>", "Sender")
  .action(async (opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const { postTurn, appendLocalLog } = await import("../src/turn.js");
    const msg = postTurn({
      from: opts.from || detectProvider(),
      to: opts.to || null,
      room: opts.room,
      summary: opts.text,
      outcome: opts.outcome,
    });
    appendLocalLog(`${msg.from}: ${opts.text}`);
    console.log(JSON.stringify(msg, null, 2));
  });

program
  .command("inbox")
  .description("List unread messages")
  .option("-a, --agent <id>", "Agent id")
  .option("-n, --limit <n>", "Max results", "20")
  .option("-r, --room <room>", "Room filter")
  .option("--read", "Mark returned messages as read")
  .option("--pretty", "Human lines instead of JSON")
  .action(async (opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const store = await import("../src/store.js");
    const { formatInboxLines } = await import("../src/format.js");
    const id = opts.agent || detectProvider();
    const messages = store.checkInbox(id, {
      limit: Number(opts.limit),
      room: opts.room || null,
    });
    if (opts.read) for (const m of messages) store.readMessage(id, m.id);
    if (opts.pretty) {
      console.log(formatInboxLines(messages).join("\n") || "(empty)");
    } else {
      console.log(JSON.stringify({ agent_id: id, messages }, null, 2));
    }
  });

program
  .command("thread")
  .description("Show a message thread")
  .argument("<id>", "Message id")
  .action(async (id) => {
    const store = await import("../src/store.js");
    console.log(JSON.stringify(store.getThread(Number(id)), null, 2));
  });

program
  .command("search")
  .description("Search message bodies")
  .argument("<query>", "Search string")
  .option("-n, --limit <n>", "Max", "50")
  .action(async (query, opts) => {
    const store = await import("../src/store.js");
    console.log(
      JSON.stringify(
        store.searchMessages({ query, limit: Number(opts.limit) }),
        null,
        2
      )
    );
  });

program
  .command("history")
  .description("Recent messages")
  .option("-a, --agent <id>")
  .option("-r, --room <room>")
  .option("-n, --limit <n>", "50")
  .action(async (opts) => {
    const store = await import("../src/store.js");
    console.log(
      JSON.stringify(
        store.listHistory({
          agentId: opts.agent || null,
          room: opts.room || null,
          limit: Number(opts.limit),
        }),
        null,
        2
      )
    );
  });

program
  .command("watch")
  .description("Poll inbox and print new mail")
  .option("-a, --agent <id>")
  .option("-r, --room <room>")
  .option("-i, --interval <ms>", "1500")
  .option("--ack", "Auto-ack printed messages")
  .action(async (opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const { watchInbox } = await import("../src/watch.js");
    const ac = new AbortController();
    process.on("SIGINT", () => ac.abort());
    console.error(
      `watching as ${opts.agent || detectProvider()} (ctrl-c to stop)`
    );
    watchInbox({
      agentId: opts.agent || detectProvider(),
      room: opts.room || null,
      intervalMs: Number(opts.interval),
      ack: Boolean(opts.ack),
      signal: ac.signal,
    });
    await new Promise(() => {});
  });

program
  .command("board")
  .description("Print status board")
  .action(async () => {
    const { renderBoard } = await import("../src/board.js");
    console.log(renderBoard());
  });

program
  .command("stats")
  .description("Mailbox stats JSON")
  .action(async () => {
    const store = await import("../src/store.js");
    console.log(JSON.stringify(store.stats(), null, 2));
  });

program
  .command("rooms")
  .description("List rooms")
  .action(async () => {
    const store = await import("../src/store.js");
    console.log(JSON.stringify(store.listRooms(), null, 2));
  });

program
  .command("agents")
  .description("List recent agents")
  .action(async () => {
    const store = await import("../src/store.js");
    console.log(JSON.stringify(store.listAgents(), null, 2));
  });

program
  .command("status")
  .description("Get or set agent status")
  .argument("[agent]", "Agent id")
  .option("-s, --set <status>", "idle | working | waiting")
  .action(async (agent, opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const store = await import("../src/store.js");
    const id = agent || detectProvider();
    if (opts.set) console.log(JSON.stringify(store.setStatus(id, opts.set), null, 2));
    else console.log(JSON.stringify(store.getStatus(id), null, 2));
  });

program
  .command("react")
  .description("React to a message")
  .argument("<id>", "Message id")
  .argument("<emoji>", "Emoji")
  .option("-a, --agent <id>")
  .action(async (id, emoji, opts) => {
    const { detectProvider } = await import("../src/identity.js");
    const store = await import("../src/store.js");
    console.log(
      JSON.stringify(
        store.react(Number(id), opts.agent || detectProvider(), emoji),
        null,
        2
      )
    );
  });

program
  .command("archive")
  .description("Archive a message")
  .argument("<id>", "Message id")
  .action(async (id) => {
    const store = await import("../src/store.js");
    console.log(JSON.stringify(store.archiveMessage(Number(id)), null, 2));
  });

program
  .command("hooks")
  .description("Install local turn-hook helpers")
  .action(async () => {
    const turn = await import("../src/turn.js");
    console.log(JSON.stringify(turn.installCursorHooks(process.cwd()), null, 2));
    console.log(JSON.stringify(turn.installClaudeStopHint(), null, 2));
  });

program.parse();
