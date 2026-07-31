#!/usr/bin/env node
import { startHub } from "./server.js";

const portArg = process.argv.find((a) => a.startsWith("--port="));
const hostArg = process.argv.find((a) => a.startsWith("--host="));
const port = portArg ? Number(portArg.split("=")[1]) : undefined;
const host = hostArg ? hostArg.split("=")[1] : undefined;

startHub({ port: Number.isFinite(port) ? port : undefined, host }).catch((err) => {
  console.error("[markdown-mcp-hub] failed to start:", err);
  process.exit(1);
});
