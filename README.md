# MarkdownMCP

Live markdown preview for LLM agents. The agent calls **one tool** when a markdown file comes into scope; a shared hub watches the file, opens your OS default browser (managed profile) on the first create/change, and streams updates into a multi-tab Vue UI (unread dots, toggleable change marks, history).

## Features

- **One MCP tool:** `scope_markdown` — call once before the first write (path may not exist yet)
- **Singleton hub** shared by all MCP clients; exits when no clients remain
- **Sticky high port** — hub reuses a preferred port from `settings.json` so preview tabs reconnect after restarts
- **Managed browser profile** — system default browser with an isolated profile under the app data dir; left open when the hub exits
- **Reconnect-first** — does not spawn a new window if a managed browser session is already running
- **In-app tabs** with subtle unread indicators
- **Toggleable change highlights** + snapshot history
- **First-run settings** (theme, bind host, preferred port, allowed path roots)
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
Hub  --spawn--> system default browser + managed profile (first file event, if none running)
```

State lives under:

| Platform | Directory |
|----------|-----------|
| Windows | `%LOCALAPPDATA%\markdown-mcp\` |
| macOS | `~/Library/Application Support/markdown-mcp/` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/markdown-mcp/` |

| File / dir | Role |
|------------|------|
| `hub.json` | Live hub URL/port/pid (cleared when hub stops) |
| `settings.json` | Theme, bind host, **preferredPort**, browser prefs |
| `hub.lock` | Singleton lock |
| `browser-profile/` | Managed browser user-data / profile |
| `browser.pid` | Last launched browser pid (reconnect-first) |

## Development

```bash
npm install
npm run build
npm run start:hub          # hub only (stays up until Ctrl+C; no MCP client timeout if you register manually)
npm run start:mcp          # MCP stdio server (spawns hub as needed)
npm run dev:web            # Vite UI against a hub on :7420 (optional proxy)
npm run test:unit          # shared + hub unit tests
npm run test:local         # unit + sticky-port + browser policy + default-browser
npm run test:sticky-port   # sticky port integration (uses real app data dir)
npm run test:default-browser  # OS default product → binary (skips if browser missing)
```

Install-dependent checks (Brave/Chrome/Edge/Firefox present on disk, OS default detection)
**skip** with a clear message when the browser is not installed — they do not fail CI machines without that browser.


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
| Preferred port | auto (high port 49152–65535, then sticky) |
| Allowed path roots | empty = allow any |
| Open browser on first file event | on |
| Preserve scroll | on |
| Show changes by default | on |

Changing **bind host** or **preferred port** requires a hub restart. Non-loopback binds ask for confirmation.

### Sticky port & browser profile

1. On first start (or empty preferred port), the hub binds a free **high** port and writes it to `settings.json` as `preferredPort`.
2. Later starts **try that port first**. If it is taken, the hub picks another free high port and updates `preferredPort`.
3. On the first scoped file create/change (when enabled), the hub launches the **system default browser** with a dedicated profile under `browser-profile/`. Common engines are supported (Chrome/Edge/Brave/Chromium via `--user-data-dir`, Firefox via `-profile`). Safari and unknown browsers fall back to a normal URL open with limited isolation.
4. If a managed browser session is **already running**, the hub does **not** open another window (the open tab reconnects over WebSocket).
5. Stopping the hub **does not** close the browser.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Hub won't start | Delete `%LOCALAPPDATA%\markdown-mcp\hub.lock` and `hub.json` if stale |
| Browser never opens | Scope a file **and** write it; browser waits for first create/change. Confirm “Open browser on first file event” is on. |
| Extra browser windows | Hub skips launch when `browser.pid` / profile locks show a live session; close the preview browser if you need a clean relaunch |
| Tab won’t reconnect after restart | Ensure sticky `preferredPort` is free; check Settings → Preferred port and `hub.json` |
| Path denied | Add root under Settings → Allowed path roots |
| UI is fallback HTML | Run `npm run build` so `packages/hub/dist/public` is populated |
| Port unknown | Read `hub.json` (live) or `preferredPort` in `settings.json` (sticky) |

## License

MIT
