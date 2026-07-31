import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const HOME = homedir();
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function which(cmd) {
  try {
    return execSync(`command -v ${cmd}`, { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function resolveServerCmd() {
  if (which("mailnotmilk")) {
    return { command: "mailnotmilk", args: ["serve"] };
  }
  return { command: "npx", args: ["-y", "mailnotmilk", "serve"] };
}

function readJson(path, fallback = {}) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`  ✓ ${path}`);
}

function writeText(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`  ✓ ${path}`);
}

function appendUnique(path, content, marker) {
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8");
    if (existing.includes(marker)) {
      console.log(`  ~ ${path} (already configured)`);
      return;
    }
    writeFileSync(path, existing.trimEnd() + "\n\n" + content + "\n");
  } else {
    writeText(path, content + "\n");
  }
  console.log(`  ✓ ${path}`);
}

const { command, args } = resolveServerCmd();
const MCP_ENTRY = { command, args };

const MAILBOX_RULES = `## mailnotmilk

MCP server available: \`mailnotmilk\`
- \`whoami\` — detected agent id
- \`register_agent\` — join the roster
- \`post_message\` — DM or room broadcast
- \`check_inbox\` — unread mail (optional wait_ms)
- \`read_message\` — ack a message
- \`reply_message\` — threaded reply
- \`list_agents\` / \`set_status\` / \`get_status\` — presence

When collaborating across Cursor and Claude Code (or other agents):
1. \`register_agent\` / \`whoami\` at session start
2. \`check_inbox\` before and after substantive work
3. \`post_message\` or \`reply_message\` with handoffs and results
Do not wait for the human to say "check your mail" every time.`;

const TOOL_INSTALLERS = {
  "claude-code": () => {
    const settingsPath = join(HOME, ".claude", "settings.json");
    const settings = readJson(settingsPath);
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers.mailnotmilk = MCP_ENTRY;
    writeJson(settingsPath, settings);

    const cmdDir = join(HOME, ".claude", "commands");
    mkdirSync(cmdDir, { recursive: true });
    const cmdPath = join(cmdDir, "mailbox.md");
    if (!existsSync(cmdPath)) {
      writeText(
        cmdPath,
        `# mailbox

Check and send shared agent mail via mailnotmilk.

## Usage
\`/mailbox\` — check inbox
\`/mailbox send <agent> <text>\` — DM another agent

## Steps
1. Call \`whoami\` if unsure of your id
2. Call \`check_inbox\` (optionally wait_ms=2000)
3. \`read_message\` then \`reply_message\` as needed
4. Use \`post_message\` for new handoffs
`
      );
    }
  },

  cursor: () => {
    const configPath = join(HOME, ".cursor", "mcp.json");
    const config = readJson(configPath);
    config.mcpServers = config.mcpServers || {};
    // Default Cursor identity to deepseek so DeepSeek chats bridge cleanly to Claude Code.
    // Override with MAILNOTMILK_AGENT_ID in the env block if you use another model name.
    config.mcpServers.mailnotmilk = {
      ...MCP_ENTRY,
      env: {
        MAILNOTMILK_AGENT_ID: process.env.MAILNOTMILK_AGENT_ID || "deepseek",
      },
    };
    writeJson(configPath, config);

    writeJson(join(PKG_ROOT, ".cursor", "mcp.json"), {
      mcpServers: {
        mailnotmilk: {
          ...MCP_ENTRY,
          env: { MAILNOTMILK_AGENT_ID: "deepseek" },
        },
      },
    });
    writeJson(join(PKG_ROOT, ".mcp.json"), {
      mcpServers: {
        mailnotmilk: {
          ...MCP_ENTRY,
          env: { MAILNOTMILK_AGENT_ID: "deepseek" },
        },
      },
    });
  },

  windsurf: () => {
    const configPath = join(HOME, ".codeium", "windsurf", "mcp_config.json");
    const config = readJson(configPath);
    config.mcpServers = config.mcpServers || {};
    config.mcpServers.mailnotmilk = MCP_ENTRY;
    writeJson(configPath, config);
  },

  codex: () => {
    appendUnique(join(HOME, "AGENTS.md"), MAILBOX_RULES, "mailnotmilk");
  },

  gemini: () => {
    const settingsPath = join(HOME, ".gemini", "settings.json");
    const settings = readJson(settingsPath);
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers.mailnotmilk = MCP_ENTRY;
    writeJson(settingsPath, settings);
  },

  opencode: () => {
    const configPath = join(HOME, ".config", "opencode", "opencode.json");
    const config = readJson(configPath);
    config.mcp = config.mcp || {};
    config.mcp.servers = config.mcp.servers || {};
    config.mcp.servers.mailnotmilk = MCP_ENTRY;
    writeJson(configPath, config);
  },

  continue: () => {
    const configPath = join(HOME, ".continue", "config.json");
    const config = readJson(configPath);
    config.mcpServers = config.mcpServers || [];
    if (!config.mcpServers.find((s) => s.name === "mailnotmilk")) {
      config.mcpServers.push({ name: "mailnotmilk", ...MCP_ENTRY });
      writeJson(configPath, config);
    } else {
      console.log(`  ~ ${configPath} (already configured)`);
    }
  },

  cline: () => {
    const rulesDir = join(HOME, ".clinerules");
    mkdirSync(rulesDir, { recursive: true });
    const rulePath = join(rulesDir, "mailnotmilk.md");
    if (!existsSync(rulePath)) {
      writeText(rulePath, `# mailnotmilk\n\n${MAILBOX_RULES}\n`);
    } else {
      console.log(`  ~ ${rulePath} (already configured)`);
    }
  },

  aider: () => {
    appendUnique(
      join(HOME, ".aider.conf.yml"),
      `# mailnotmilk: shared agent mailbox MCP — run 'mailnotmilk serve' from an MCP-capable editor`,
      "mailnotmilk"
    );
  },

  "github-copilot": () => {
    appendUnique(
      join(HOME, ".github", "copilot-instructions.md"),
      MAILBOX_RULES,
      "mailnotmilk"
    );
  },
};

export async function install(tools) {
  const all = Object.keys(TOOL_INSTALLERS);
  const targets =
    tools === "all" ? all : Array.isArray(tools) ? tools : [tools];

  for (const tool of targets) {
    const installer = TOOL_INSTALLERS[tool];
    if (!installer) {
      console.log(`  ? Unknown tool: ${tool} (available: ${all.join(", ")})`);
      continue;
    }
    console.log(`\nInstalling for ${tool}...`);
    try {
      await installer();
    } catch (err) {
      console.log(`  ✗ ${tool}: ${err.message}`);
    }
  }

  console.log("\nDone. Restart your AI tool to pick up the new MCP server.");
}

export const AVAILABLE_TOOLS = Object.keys(TOOL_INSTALLERS);
