import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverSkills,
  installSkillsForTarget,
} from "../src/install.js";
import { listSites as browserSites } from "../src/browser.js";

describe("skills install", () => {
  it("discovers skill markdown files", () => {
    const skills = discoverSkills();
    assert.ok(skills.some((s) => s.name === "mailnotmilk-bridge"));
    assert.ok(skills.some((s) => s.name === "browser-relay"));
    assert.ok(skills[0].body.includes("name:"));
  });

  it("writes jayden-style skill paths into a target", () => {
    const dir = mkdtempSync(join(tmpdir(), "mnm-skills-"));
    try {
      installSkillsForTarget(dir, ["cursor", "claude", "opencode"]);
      assert.ok(
        existsSync(join(dir, ".cursor/skills/mailnotmilk-bridge/SKILL.md"))
      );
      assert.ok(
        existsSync(join(dir, ".claude/skills/browser-relay/SKILL.md"))
      );
      assert.ok(
        existsSync(join(dir, ".opencode/skills/mailnotmilk-bridge/SKILL.md"))
      );
      const body = readFileSync(
        join(dir, ".cursor/skills/mailnotmilk-bridge/SKILL.md"),
        "utf8"
      );
      assert.match(body, /bridge_to_claude/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("browser sites", () => {
  it("lists known AI web UIs", () => {
    const sites = browserSites();
    assert.ok(sites.includes("chatgpt"));
    assert.ok(sites.includes("deepseek"));
    assert.ok(sites.includes("gemini"));
  });
});
