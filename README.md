# MarkdownMCP

Live markdown preview for LLM agents. The agent calls **one tool** when a markdown file comes into scope; a shared hub watches the file, opens your OS default browser on the first create/change, and streams updates into a multi-tab Vue UI (unread dots, toggleable change marks, history).

## Features

- **One MCP tool:** `scope_markdown` — call once before the first write (path may not exist yet)
- **Singleton hub** shared by all MCP clients; exits when no clients remain
- **OS default browser** — opened on first scoped file create/change (not hub start)
- **In-app tabs** with subtle unread indicators
- **Toggleable change highlights** + snapshot history
- **First-run settings** (theme, bind host, allowed path roots)
- **Cross-platform** (Windows, macOS, Linux)

## Quick install (Grok)

From this repo (after build), or once published:

```bash
# From monorepo root
npm install
npm run build

# User-level MCP (Grok)
grok mcp add markdown-mcp -- node /absolute/path/to/live-markdown-mcp/packages/mcp/dist/cli.js
```

Or with a global/workspace link:

```bash
npm link -w markdown-mcp
grok mcp add markdown-mcp -- markdown-mcp
```

`~/.grok/config.toml` equivalent:

```toml
[mcp_servers.markdown-mcp]
command = "node"
args = ["/absolute/path/to/live-markdown-mcp/packages/mcp/dist/cli.js"]
enabled = true
startup_timeout_sec = 60
```

Copy the skill so the model knows when to call the tool:

```bash
# Windows PowerShell
Copy-Item -Recurse .grok/skills/markdown-scope $HOME/.grok/skills/markdown-scope
```

## Other clients

### Claude Code

```bash
claude mcp add markdown-mcp -- node /absolute/path/to/live-markdown-mcp/packages/mcp/dist/cli.js
```

Or project `.mcp.json`:

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

### Cursor

`.cursor/mcp.json`:

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

## Agent usage

```text
1. Decide you will create or edit a markdown doc the user should see rendered.
2. Call scope_markdown once with the path (absolute preferred).
3. Write/edit the file freely — do not call the tool again for edits.
```

Tool:

| Tool | Args | Purpose |
|------|------|---------|
| `scope_markdown` | `path: string` | Watch + preview this file |

## Architecture

```
MCP client(s)  --stdio-->  markdown-mcp bridge
                              |
                              +--> ensure hub up (singleton)
                              +--> register client
                              +--> scope_markdown → hub API

Hub  --chokidar--> disk
Hub  --WebSocket--> Vue UI (tabs, diffs, history)
Hub  --open--> OS default browser (first file event)
```

State lives under:

| Platform | Directory |
|----------|-----------|
| Windows | `%LOCALAPPDATA%\markdown-mcp\` |
| macOS | `~/Library/Application Support/markdown-mcp/` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/markdown-mcp/` |

Files: `hub.json` (dynamic port), `settings.json`, `hub.lock`.

## Development

```bash
npm install
npm run build
npm run start:hub          # hub only (stays up until Ctrl+C; no MCP client timeout if you register manually)
npm run start:mcp          # MCP stdio server (spawns hub as needed)
npm run dev:web            # Vite UI against a hub on :7420 (optional proxy)
```

Packages:

| Package | Role |
|---------|------|
| `@markdown-mcp/shared` | Types + defaults |
| `@markdown-mcp/hub` | HTTP/WS hub, watchers, browser |
| `@markdown-mcp/web` | Vue UI |
| `markdown-mcp` | MCP stdio entry (`scope_markdown`) |

## Settings

First browser open shows a short wizard. Later: **Settings** in the UI.

| Setting | Default |
|---------|---------|
| Theme | System / Light / Dark |
| Bind host | `127.0.0.1` |
| Allowed path roots | empty = allow any |
| Open browser on first file event | on |
| Preserve scroll | on |
| Show changes by default | on |

Changing **bind host** requires a hub restart. Non-loopback binds ask for confirmation.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Hub won't start | Delete `%LOCALAPPDATA%\markdown-mcp\hub.lock` and `hub.json` if stale |
| Browser never opens | Scope a file **and** write it; browser waits for first create/change |
| Path denied | Add root under Settings → Allowed path roots |
| UI is fallback HTML | Run `npm run build` so `packages/hub/dist/public` is populated |
| Port unknown | Read `hub.json` in the app data dir |

## License

MIT
