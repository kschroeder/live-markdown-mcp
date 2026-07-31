#!/usr/bin/env node
import { startMcpServer } from "./server.js";

startMcpServer().catch((err) => {
  console.error("[markdown-mcp]", err);
  process.exit(1);
});
