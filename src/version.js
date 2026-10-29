import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Single source of truth for the package version.
 *
 * The MCP server used to declare its own literal (`1.5.0`) while package.json
 * said `1.6.6`, so clients were told a version that did not exist. Anything
 * that reports a version must read this module instead of writing a literal.
 */
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")
);

export const VERSION = pkg.version;
export default VERSION;
