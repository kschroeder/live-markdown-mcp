# Install MarkdownMCP for Grok

## 1. Build

```bash
cd /path/to/MarkdownMCP
npm install
npm run build
```

## 2. Register MCP

```bash
grok mcp add markdown-mcp -- node F:/Grok/Projects/MarkdownMCP/packages/mcp/dist/cli.js
```

Use your real absolute path. On Windows, forward slashes are fine.

Raise startup timeout if cold start is slow:

```toml
# ~/.grok/config.toml
[mcp_servers.markdown-mcp]
command = "node"
args = ["F:/Grok/Projects/MarkdownMCP/packages/mcp/dist/cli.js"]
enabled = true
startup_timeout_sec = 60
```

## 3. Skill (recommended)

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.grok\skills" | Out-Null
Copy-Item -Recurse -Force "F:\Grok\Projects\MarkdownMCP\.grok\skills\markdown-scope" "$env:USERPROFILE\.grok\skills\markdown-scope"
```

## 4. Verify

```bash
grok mcp list
grok mcp doctor markdown-mcp
```

In a session, ask the agent to write a plan markdown file; it should call `scope_markdown` once, then write the file. The browser opens on first write.
