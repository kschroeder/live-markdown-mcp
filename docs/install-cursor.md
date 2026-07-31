# Install MarkdownMCP for Cursor

Build the monorepo, then add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "markdown-mcp": {
      "command": "node",
      "args": ["F:/Grok/Projects/MarkdownMCP/packages/mcp/dist/cli.js"]
    }
  }
}
```

Restart Cursor MCP or reload the window. Confirm tools include `scope_markdown`.
