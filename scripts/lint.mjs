#!/usr/bin/env node
/**
 * Syntax-check every JS file in the repo.
 *
 * The old script was `node --check src/*.js bin/*.js`, which looks like it
 * checks them all but does not: `node --check` parses exactly one file and
 * treats the rest as arguments. A syntax error anywhere but the first file
 * passed silently — verified by breaking src/store.js and watching lint exit 0.
 *
 * Uses the same checker Node's test runner uses, so it agrees with what
 * actually runs, and reports every failure instead of stopping at the first.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["src", "bin", "tests", "scripts", "extension"];

function collect(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(abs)) {
    if (entry.endsWith(".js") || entry.endsWith(".mjs")) {
      out.push(join(dir, entry));
    }
  }
  return out;
}

const files = DIRS.flatMap(collect);
if (!files.length) {
  console.error("lint: no files found");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  // `--check` per file: one process each, so no file is silently skipped.
  const res = spawnSync(process.execPath, ["--check", join(ROOT, file)], {
    encoding: "utf8",
  });
  if (res.status !== 0) {
    failed++;
    const detail = (res.stderr || res.stdout || "").trim();
    console.error(`lint: ${file}\n${detail}\n`);
  }
}

if (failed) {
  console.error(`lint: ${failed} of ${files.length} file(s) failed`);
  process.exit(1);
}

console.log(`lint: ${files.length} file(s) OK`);
