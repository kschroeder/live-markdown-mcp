# Install MarkdownMCP for Claude Code

```bash
npm install && npm run build
claude mcp add markdown-mcp -- node /absolute/path/to/live-markdown-mcp/packages/mcp/dist/cli.js
```

Project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "markdown-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/live-markdown-mcp/packages/mcp/dist/cli.js"]
    }
  }
}
```

Optional: copy `AGENTS.md` rules into your project or add the skill under `.claude/skills/markdown-scope/` (same `SKILL.md` body as `.grok/skills/markdown-scope/`).
