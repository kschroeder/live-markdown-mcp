import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerClient, scopeMarkdown, unregisterClient } from "./hub-client.js";

export async function startMcpServer(): Promise<void> {
  // Connect MCP first so the host handshake does not wait on hub startup.
  const server = new McpServer({
    name: "markdown-mcp",
    version: "0.1.0",
  });

  server.tool(
    "scope_markdown",
    "Put a markdown file in scope for live browser preview. Call once before first write (path may not exist yet). Do not call again for subsequent edits — the hub watches the file.",
    {
      path: z
        .string()
        .describe("Absolute or workspace-relative path to the .md file to preview"),
    },
    async ({ path: filePath }) => {
      // Lazy hub attach on first tool use (also runs register if needed)
      try {
        await ensureRegistered();
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error starting preview hub: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }

      const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);

      const result = await scopeMarkdown(resolved);
      if ("error" in result) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const msg = result.alreadyScoped
        ? `Already in scope: ${result.path}`
        : `Scoped for live preview: ${result.path}`;

      return {
        content: [{ type: "text" as const, text: msg }],
      };
    }
  );

  let registered = false;
  async function ensureRegistered(): Promise<void> {
    if (registered) return;
    await registerClient();
    registered = true;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Warm the hub in the background so the first scope is faster.
  void ensureRegistered().catch((err) => {
    console.error("[markdown-mcp] background hub start failed:", err);
  });

  const cleanup = () => {
    void unregisterClient().finally(() => process.exit(0));
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("disconnect", cleanup);
  process.stdin.on("end", cleanup);
  process.stdin.on("close", cleanup);
}
