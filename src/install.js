import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const HOME = homedir();
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(PKG_ROOT, "skills");

function which(cmd) {
  try {
    return execSync(`command -v ${cmd}`, { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function resolveServerCmd() {
  // Prefer local checkout CLI when installing from a clone (jayden-style).
  const localCli = join(PKG_ROOT, "bin", "mailnotmilk.js");
  if (existsSync(localCli)) {
    return { command: process.execPath, args: [localCli, "serve"] };
  }
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

MCP server: \`mailnotmilk\` — bridge browser AIs (ChatGPT/DeepSeek/…) with Claude Code, Cursor, OpenCode.

Prefer:
- \`bridge_to_claude\` / \`create_chat\` (paste invite — does not auto-open apps)
- \`browser_connect\` / \`browser_extract_messages\` / \`browser_send_message\` / \`relay_tick\`
- \`chat_say\` / \`chat_history\` / \`check_inbox\`

See skill \`mailnotmilk-bridge\` and \`browser-relay\`.`;

/** Jayden-style skill destination templates (project-relative). */
export const SKILL_PATHS = {
  cursor: ".cursor/skills/{name}/SKILL.md",
  claude: ".claude/skills/{name}/SKILL.md",
  "claude-code": ".claude/skills/{name}/SKILL.md",
  copilot: ".github/skills/{name}/SKILL.md",
  "github-copilot": ".github/skills/{name}/SKILL.md",
  gemini: ".gemini/skills/{name}/SKILL.md",
  opencode: ".opencode/skills/{name}/SKILL.md",
};

export function discoverSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({
      name: f.replace(/\.md$/, ""),
      path: join(SKILLS_DIR, f),
      body: readFileSync(join(SKILLS_DIR, f), "utf8"),
    }));
}

function hasFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return false;
  const end = normalized.indexOf("\n---", 4);
  return end !== -1 && /^name:\s*\S/m.test(normalized.slice(4, end));
}

export function installSkillsForTarget(target, providers, { force = true } = {}) {
  const skills = discoverSkills();
  const root = resolve(target || process.cwd());
  for (const provider of providers) {
    const tpl = SKILL_PATHS[provider];
    if (!tpl) continue;
    for (const skill of skills) {
      if (provider === "claude" || provider === "claude-code") {
        if (!hasFrontmatter(skill.body)) {
          console.log(`  ~ skip ${skill.name} for ${provider} (needs YAML name frontmatter)`);
          continue;
        }
      }
      const dest = join(root, tpl.replace("{name}", skill.name));
      writeText(dest, skill.body);
    }
  }
}

export function installSkillsGlobal() {
  const skills = discoverSkills();
  for (const skill of skills) {
    writeText(
      join(HOME, ".cursor", "skills", skill.name, "SKILL.md"),
      skill.body
    );
    if (hasFrontmatter(skill.body)) {
      writeText(
        join(HOME, ".claude", "skills", skill.name, "SKILL.md"),
        skill.body
      );
    }
    writeText(
      join(HOME, ".opencode", "skills", skill.name, "SKILL.md"),
      skill.body
    );
    writeText(
      join(HOME, ".gemini", "skills", skill.name, "SKILL.md"),
      skill.body
    );
  }
}

function mcpIntoProject(target) {
  const root = resolve(target);
  writeJson(join(root, ".cursor", "mcp.json"), {
    mcpServers: {
      mailnotmilk: {
        ...MCP_ENTRY,
        env: { MAILNOTMILK_AGENT_ID: process.env.MAILNOTMILK_AGENT_ID || "deepseek" },
      },
    },
  });
  writeJson(join(root, ".mcp.json"), {
    mcpServers: { mailnotmilk: MCP_ENTRY },
  });
}

const TOOL_INSTALLERS = {
  "claude-code": () => {
    const settingsPath = join(HOME, ".claude", "settings.json");
    const settings = readJson(settingsPath);
    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers.mailnotmilk = MCP_ENTRY;
    writeJson(settingsPath, settings);

    const cmdDir = join(HOME, ".claude", "commands");
    mkdirSync(cmdDir, { recursive: true });
    writeText(
      join(cmdDir, "mailbox.md"),
      `# mailbox

mailnotmilk bridge / inbox.

## Usage
\`/mailbox\` — check inbox / chat_history
\`/mailbox bridge\` — ask to bridge_to_claude or relay_tick

## Steps
1. join_chat or bridge_to_claude as needed
2. chat_say / check_inbox
3. For browser AI tabs: browser_* + relay_tick
`
    );
  },

  cursor: () => {
    const configPath = join(HOME, ".cursor", "mcp.json");
    const config = readJson(configPath);
    config.mcpServers = config.mcpServers || {};
    config.mcpServers.mailnotmilk = {
      ...MCP_ENTRY,
      env: {
        MAILNOTMILK_AGENT_ID: process.env.MAILNOTMILK_AGENT_ID || "deepseek",
      },
    };
    writeJson(configPath, config);
    mcpIntoProject(PKG_ROOT);
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
    writeText(join(rulesDir, "mailnotmilk.md"), `# mailnotmilk\n\n${MAILBOX_RULES}\n`);
  },

  aider: () => {
    appendUnique(
      join(HOME, ".aider.conf.yml"),
      `# mailnotmilk MCP — browser AI ↔ coding agents`,
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

/**
 * @param {string|string[]} tools
 * @param {object} [opts]
 */
export async function install(tools, opts = {}) {
  const {
    target = null,
    skills = false,
    globalSkills = false,
    browsers = true,
    skipBrowsers = false,
    withDeps = null,
  } = opts;

  const all = Object.keys(TOOL_INSTALLERS);
  const targets =
    tools === "all" ? all : Array.isArray(tools) ? tools : [tools];

  for (const tool of targets) {
    const installer = TOOL_INSTALLERS[tool];
    if (!installer) {
      console.log(`  ? Unknown tool: ${tool} (available: ${all.join(", ")})`);
      continue;
    }
    console.log(`\nInstalling MCP for ${tool}...`);
    try {
      await installer();
    } catch (err) {
      console.log(`  ✗ ${tool}: ${err.message}`);
    }
  }

  const skillProviders = targets
    .map((t) => (t === "claude-code" ? "claude" : t === "github-copilot" ? "copilot" : t))
    .filter((t) => SKILL_PATHS[t]);

  if (skills || target) {
    const root = target || process.cwd();
    console.log(`\nInstalling skills into ${resolve(root)}...`);
    installSkillsForTarget(
      root,
      skillProviders.length
        ? skillProviders
        : ["cursor", "claude", "opencode", "gemini", "copilot"]
    );
    mcpIntoProject(root);
  }

  if (globalSkills || skills) {
    console.log("\nInstalling user-level skills (~/.cursor, ~/.claude, …)...");
    installSkillsGlobal();
  }

  if (browsers && !skipBrowsers) {
    try {
      const { ensureRelayRuntime } = await import("./playwright-setup.js");
      await ensureRelayRuntime({ skipBrowsers: false, withDeps });
    } catch (err) {
      console.log(`  ✗ browser runtime: ${err.message}`);
      console.log(
        "  You can retry: mailnotmilk install --browsers-only --skip-deps"
      );
    }
  }

  console.log("\nInstalling PATH shim (mailnotmilk command)…");
  try {
    const { installPathShim } = await import("./path-shim.js");
    installPathShim();
  } catch (err) {
    console.log(`  ✗ path shim: ${err.message}`);
  }

  console.log("\nDone. Restart your AI tool to pick up MCP + skills.");
  console.log("Run hub+relay:  ./run.sh");
  console.log("Or:            ./install.sh --run");
  console.log(
    "ChatGPT tab: start Chrome with --remote-debugging-port=9222 then ./run.sh"
  );
}

export const AVAILABLE_TOOLS = Object.keys(TOOL_INSTALLERS);
