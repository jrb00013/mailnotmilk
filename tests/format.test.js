import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatInboxLines } from "../src/format.js";

describe("formatInboxLines", () => {
  it("formats dm", () => {
    const lines = formatInboxLines([
      { id: 1, from: "cursor", to: "claude", room: "general", text: "hi" },
    ]);
    assert.match(lines[0], /#1/);
    assert.match(lines[0], /cursor/);
  });
});
