import http from "node:http";
import { URL } from "node:url";
import {
  getChat,
  getChatByInvite,
  listChats,
  chatMessages,
  buildInviteBundle,
  joinByInvite,
  postToChat,
  createChat,
  ensureChatSchema,
} from "./chats.js";
import { detectProvider } from "./identity.js";
import { getDb } from "./store.js";
import { renderBoard } from "./board.js";

const DEFAULT_PORT = Number(process.env.MAILNOTMILK_HUB_PORT || 7879);

function json(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function html(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ raw });
      }
    });
    req.on("error", reject);
  });
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)} · mailnotmilk</title>
<style>
  :root {
    --bg: #0f1419;
    --panel: #1a222c;
    --ink: #e7ecf1;
    --muted: #8b9aab;
    --accent: #3dd6c6;
    --warn: #f0a202;
    --line: #2a3542;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
    background: radial-gradient(1200px 600px at 10% -10%, #1c3a3a 0%, var(--bg) 55%);
    color: var(--ink); min-height: 100vh;
  }
  header {
    padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--line);
    display: flex; gap: 1rem; align-items: baseline; flex-wrap: wrap;
  }
  header strong { color: var(--accent); font-size: 1.15rem; letter-spacing: 0.02em; }
  header span { color: var(--muted); font-size: 0.9rem; }
  main { max-width: 960px; margin: 0 auto; padding: 1.5rem; }
  .card {
    background: color-mix(in srgb, var(--panel) 92%, black);
    border: 1px solid var(--line); border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem;
  }
  .warn {
    border-color: color-mix(in srgb, var(--warn) 50%, var(--line));
    background: color-mix(in srgb, var(--warn) 12%, var(--panel));
    color: #ffe6a8; font-size: 0.95rem; line-height: 1.45;
  }
  h1 { font-size: 1.6rem; margin: 0 0 0.35rem; font-family: "IBM Plex Serif", Georgia, serif; }
  h2 { font-size: 1rem; margin: 0 0 0.75rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
  pre, textarea {
    width: 100%; background: #0b1015; color: var(--ink); border: 1px solid var(--line);
    border-radius: 8px; padding: 0.85rem; font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 0.85rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
  }
  textarea { min-height: 140px; resize: vertical; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; }
  button, .btn {
    appearance: none; border: 0; border-radius: 8px; padding: 0.55rem 0.9rem;
    background: var(--accent); color: #04221f; font-weight: 650; cursor: pointer;
    text-decoration: none; display: inline-block; font-size: 0.9rem;
  }
  button.secondary, .btn.secondary { background: transparent; color: var(--ink); border: 1px solid var(--line); }
  .msgs { display: flex; flex-direction: column; gap: 0.65rem; }
  .msg {
    border-left: 3px solid var(--accent); padding: 0.55rem 0.75rem;
    background: #121820; border-radius: 0 8px 8px 0;
  }
  .msg .meta { color: var(--muted); font-size: 0.78rem; margin-bottom: 0.25rem; }
  .msg.system { border-left-color: var(--muted); }
  .msg.handoff { border-left-color: var(--warn); }
  a { color: var(--accent); }
  input[type=text] {
    flex: 1; min-width: 180px; background: #0b1015; border: 1px solid var(--line);
    color: var(--ink); border-radius: 8px; padding: 0.55rem 0.75rem;
  }
</style>
</head>
<body>
<header>
  <strong>mailnotmilk</strong>
  <span>local agent chat hub</span>
  <span style="margin-left:auto"><a href="/">home</a> · <a href="/board">board</a> · <a href="/api/chats">api</a></span>
</header>
<main>${body}</main>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function homePage() {
  const chats = listChats({ limit: 30 });
  const list = chats.length
    ? `<div class="msgs">${chats
        .map(
          (c) =>
            `<div class="msg"><div class="meta">${escapeHtml(c.createdAt)} · ${escapeHtml(c.createdBy)} · room ${escapeHtml(c.room)}</div>
             <a href="/c/${escapeHtml(c.id)}"><strong>${escapeHtml(c.title)}</strong></a>
             <div class="meta">${c.members.map((m) => m.agentId).join(", ") || "no members"}</div></div>`
        )
        .join("")}</div>`
    : `<p style="color:var(--muted)">No chats yet. Create one below.</p>`;

  return pageShell(
    "Hub",
    `
    <div class="card warn">
      <strong>Important:</strong> posting mail does <em>not</em> pop open Claude Code or Cursor.
      Share the <em>chat link</em> (or the copy-paste peer prompt) into the other agent’s chat.
      They join, then both sides talk in the same thread.
    </div>
    <div class="card">
      <h1>Start a chat</h1>
      <form method="POST" action="/api/chats" id="create">
        <div class="row">
          <input type="text" name="title" placeholder="Chat title (e.g. review auth.js)" required />
          <input type="text" name="createdBy" placeholder="your id (cursor)" value="cursor" />
          <button type="submit">Create + get link</button>
        </div>
      </form>
      <p style="color:var(--muted);font-size:0.9rem">Or CLI: <code>mailnotmilk chat new -t "review auth"</code></p>
    </div>
    <div class="card">
      <h2>Recent chats</h2>
      ${list}
    </div>
    <script>
      document.getElementById('create').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const res = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: fd.get('title'),
            createdBy: fd.get('createdBy') || 'cursor'
          })
        });
        const data = await res.json();
        if (data.joinUrl) location.href = '/c/' + data.chat.id;
        else alert(JSON.stringify(data));
      });
    </script>`
  );
}

function chatPage(chat, invite) {
  const bundle = buildInviteBundle(chat);
  const msgs = chatMessages(chat.id, { limit: 200 });
  const msgHtml = msgs
    .map((m) => {
      const cls = m.type === "system" ? "system" : m.type === "handoff" ? "handoff" : "";
      return `<div class="msg ${cls}"><div class="meta">#${m.id} · ${escapeHtml(m.from)}${m.to ? " → " + escapeHtml(m.to) : ""} · ${escapeHtml(m.ts)} · ${escapeHtml(m.type)}</div><div>${escapeHtml(m.text)}</div></div>`;
    })
    .join("");

  return pageShell(
    chat.title,
    `
    <div class="card warn">
      This link does not auto-launch Claude. Copy the peer prompt into Claude Code / Cursor.
    </div>
    <div class="card">
      <h1>${escapeHtml(chat.title)}</h1>
      <p style="color:var(--muted);margin:0">id <code>${escapeHtml(chat.id)}</code> · room <code>${escapeHtml(chat.room)}</code> · members ${chat.members.map((m) => escapeHtml(m.agentId)).join(", ")}</p>
      <div class="row">
        <a class="btn" href="${escapeHtml(bundle.joinUrl)}">Join URL</a>
        <button class="secondary" type="button" onclick="navigator.clipboard.writeText(document.getElementById('peer').value)">Copy peer prompt</button>
        <button class="secondary" type="button" onclick="navigator.clipboard.writeText('${escapeHtml(bundle.joinUrl)}')">Copy link</button>
        <a class="btn secondary" href="/api/chats/${escapeHtml(chat.id)}/invite">Invite JSON</a>
      </div>
    </div>
    <div class="card">
      <h2>Paste this into the other agent</h2>
      <textarea id="peer" readonly>${escapeHtml(bundle.peerPrompt)}</textarea>
    </div>
    <div class="card">
      <h2>Thread</h2>
      <div class="msgs" id="thread">${msgHtml || '<p style="color:var(--muted)">No messages yet.</p>'}</div>
      <form id="say" class="row" style="margin-top:1rem">
        <input type="text" name="from" value="${escapeHtml(detectProvider() === "unknown" ? "human" : detectProvider())}" style="max-width:140px" />
        <input type="text" name="text" placeholder="Say something…" required style="flex:3" />
        <button type="submit">Send</button>
      </form>
    </div>
    <script>
      const chatId = ${JSON.stringify(chat.id)};
      const invite = ${JSON.stringify(invite || chat.inviteToken)};
      async function refresh() {
        const res = await fetch('/api/chats/' + chatId + '/messages');
        const data = await res.json();
        const el = document.getElementById('thread');
        el.innerHTML = (data.messages || []).map(m => {
          const cls = m.type === 'system' ? 'system' : m.type === 'handoff' ? 'handoff' : '';
          const to = m.to ? (' → ' + m.to) : '';
          return '<div class="msg ' + cls + '"><div class="meta">#' + m.id + ' · ' + m.from + to + ' · ' + m.ts + ' · ' + m.type + '</div><div>' +
            String(m.text).replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])) +
            '</div></div>';
        }).join('') || '<p style="color:var(--muted)">No messages yet.</p>';
      }
      setInterval(refresh, 2000);
      document.getElementById('say').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        await fetch('/api/chats/' + chatId + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: fd.get('from'), text: fd.get('text'), invite })
        });
        e.target.text.value = '';
        refresh();
      });
    </script>`
  );
}

export function createHubServer({ port = DEFAULT_PORT } = {}) {
  getDb();
  ensureChatSchema();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const path = url.pathname;

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        return res.end();
      }

      if (path === "/" && req.method === "GET") {
        return html(res, 200, homePage());
      }

      if (path === "/board" && req.method === "GET") {
        return html(
          res,
          200,
          pageShell("Board", `<div class="card"><pre>${escapeHtml(renderBoard())}</pre></div>`)
        );
      }

      if (path === "/api/chats" && req.method === "GET") {
        return json(res, 200, { chats: listChats() });
      }

      if (path === "/api/chats" && req.method === "POST") {
        const body = await readBody(req);
        const chat = createChat({
          title: body.title || "Untitled chat",
          createdBy: body.createdBy || detectProvider(),
          members: body.members || [],
        });
        const host = req.headers.host || `127.0.0.1:${port}`;
        const invite = buildInviteBundle(chat, {
          hubBase: `http://${host}`,
        });
        return json(res, 201, { chat, ...invite });
      }

      const chatMsg = path.match(/^\/api\/chats\/([^/]+)\/messages$/);
      if (chatMsg && req.method === "GET") {
        const chat = getChat(chatMsg[1]);
        if (!chat) return json(res, 404, { error: "not found" });
        return json(res, 200, { messages: chatMessages(chat.id) });
      }
      if (chatMsg && req.method === "POST") {
        const body = await readBody(req);
        const chat = getChat(chatMsg[1]);
        if (!chat) return json(res, 404, { error: "not found" });
        if (body.invite) {
          try {
            joinByInvite({ token: body.invite, agentId: body.from || "human" });
          } catch {
            /* already member / ignore */
          }
        }
        const msg = postToChat({
          chatId: chat.id,
          from: body.from || "human",
          text: body.text,
        });
        return json(res, 201, { message: msg });
      }

      const invitePath = path.match(/^\/api\/chats\/([^/]+)\/invite$/);
      if (invitePath && req.method === "GET") {
        const chat = getChat(invitePath[1]);
        if (!chat) return json(res, 404, { error: "not found" });
        return json(
          res,
          200,
          buildInviteBundle(chat, { hubBase: `http://127.0.0.1:${port}` })
        );
      }

      const joinApi = path.match(/^\/api\/join\/([^/]+)$/);
      if (joinApi && req.method === "POST") {
        const body = await readBody(req);
        const result = joinByInvite({
          token: joinApi[1],
          agentId: body.agentId || detectProvider(),
        });
        return json(res, 200, {
          ...result,
          invite: buildInviteBundle(result.chat, {
            hubBase: `http://127.0.0.1:${port}`,
          }),
        });
      }

      const cPath = path.match(/^\/c\/([^/]+)$/);
      if (cPath && req.method === "GET") {
        let chat = getChat(cPath[1]);
        const invite = url.searchParams.get("invite");
        if (!chat && invite) chat = getChatByInvite(invite);
        if (!chat) return html(res, 404, pageShell("Missing", "<div class='card'>Chat not found.</div>"));
        if (invite) {
          try {
            joinByInvite({
              token: invite,
              agentId: url.searchParams.get("as") || "human",
            });
            chat = getChat(chat.id);
          } catch {
            /* ignore */
          }
        }
        return html(res, 200, chatPage(chat, invite));
      }

      json(res, 404, { error: "not found", path });
    } catch (err) {
      json(res, 500, { error: err.message || String(err) });
    }
  });

  return {
    server,
    port,
    start() {
      return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          const url = `http://127.0.0.1:${port}`;
          console.error(`mailnotmilk hub listening on ${url}`);
          resolve(url);
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

export async function startHub({ port = DEFAULT_PORT } = {}) {
  const hub = createHubServer({ port });
  const url = await hub.start();
  return { ...hub, url };
}
