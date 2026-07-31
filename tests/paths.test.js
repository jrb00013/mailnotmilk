import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dataDir, dbPath, ensureDataDir } from "../src/paths.js";
import { existsSync } from "node:fs";

describe("paths", () => {
  it("respects MAILNOTMILK_DATA_DIR", () => {
    const prev = process.env.MAILNOTMILK_DATA_DIR;
    process.env.MAILNOTMILK_DATA_DIR = "/tmp/mailnotmilk-test-data";
    try {
      assert.equal(dataDir(), "/tmp/mailnotmilk-test-data");
      assert.ok(dbPath().endsWith("mailbox.db"));
    } finally {
      if (prev === undefined) delete process.env.MAILNOTMILK_DATA_DIR;
      else process.env.MAILNOTMILK_DATA_DIR = prev;
    }
  });

  it("ensureDataDir creates directory", () => {
    const prev = process.env.MAILNOTMILK_DATA_DIR;
    process.env.MAILNOTMILK_DATA_DIR = `/tmp/mailnotmilk-ensure-${Date.now()}`;
    try {
      const d = ensureDataDir();
      assert.ok(existsSync(d));
    } finally {
      if (prev === undefined) delete process.env.MAILNOTMILK_DATA_DIR;
      else process.env.MAILNOTMILK_DATA_DIR = prev;
    }
  });
});
