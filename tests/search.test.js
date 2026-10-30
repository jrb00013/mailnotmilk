import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openStore,
  useDb,
  closeStore,
  postMessage,
  searchMessages,
} from "../src/store.js";

describe("search literal wildcards", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mnm-search-"));
    useDb(openStore(join(dir, "t.db")));
    postMessage({ from: "cursor", text: "progress 100% complete" });
    postMessage({ from: "cursor", text: "progress 100x complete" });
    postMessage({ from: "cursor", text: "open file_name.txt" });
    postMessage({ from: "cursor", text: "open fileXname.txt" });
    postMessage({ from: "cursor", text: "path C:\\tmp\\build" });
  });

  afterEach(() => {
    closeStore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("treats % as a literal instead of matching everything", () => {
    const hits = searchMessages({ query: "100%" });
    assert.equal(hits.length, 1);
    assert.match(hits[0].text, /100%/);
  });

  it("treats _ as a literal instead of a single-character wildcard", () => {
    const hits = searchMessages({ query: "file_name" });
    assert.equal(hits.length, 1);
    assert.match(hits[0].text, /file_name/);
  });

  it("treats a backslash as a literal, not an escape prefix", () => {
    const hits = searchMessages({ query: "C:\\tmp" });
    assert.equal(hits.length, 1);
    assert.match(hits[0].text, /C:\\tmp/);
  });

  it("still finds ordinary substrings", () => {
    assert.equal(searchMessages({ query: "progress" }).length, 2);
    assert.equal(searchMessages({ query: "100x" }).length, 1);
  });
});
