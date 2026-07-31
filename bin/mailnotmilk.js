#!/usr/bin/env node
import { program } from "commander";
program.name("mailnotmilk").description("Shared agent mailbox MCP").version("0.0.1");
program.command("serve").action(async () => {
  const { startServer } = await import("../src/server.js");
  await startServer();
});
program.parse();
