import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/version.js";
import { createServer } from "../src/server.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const manifest = JSON.parse(
  readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8")
);

describe("version", () => {
  it("reads the version from package.json", () => {
    assert.equal(VERSION, pkg.version);
  });

  it("keeps the extension manifest in step with the package", () => {
    assert.equal(manifest.version, VERSION);
  });

  it("reports the package version to MCP clients", () => {
    const server = createServer();
    assert.equal(server.server._serverInfo.name, "mailnotmilk");
    assert.equal(
      server.server._serverInfo.version,
      VERSION,
      "the MCP handshake must not advertise a stale literal version"
    );
  });
});
