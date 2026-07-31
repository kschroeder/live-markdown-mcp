# Install MarkdownMCP for Grok

## 1. Build

```bash
cd /path/to/live-markdown-mcp
npm install
npm run build
```

## 2. Register MCP

```bash
grok mcp add markdown-mcp -- node /absolute/path/to/live-markdown-mcp/packages/mcp/dist/cli.js
```

Replace with your real absolute path. On Windows, forward slashes are fine.

Raise startup timeout if cold start is slow:

```toml
# ~/.grok/config.toml
[mcp_servers.markdown-mcp]
command = "node"
args = ["/absolute/path/to/live-markdown-mcp/packages/mcp/dist/cli.js"]
enabled = true
startup_timeout_sec = 60
```

## 3. Skill (recommended)

```bash
# Unix / macOS
cp -R .grok/skills/markdown-scope ~/.grok/skills/markdown-scope
```

```powershell
# Windows PowerShell
Copy-Item -Recurse -Force .\.grok\skills\markdown-scope $HOME\.grok\skills\markdown-scope
```

## 4. Verify

```bash
grok mcp list
grok mcp doctor markdown-mcp
```

In a session, ask the agent to write a plan markdown file; it should call `scope_markdown` once, then write the file. The browser opens on first write.
