# Agent instructions — MarkdownMCP

## When to preview markdown

If you will create or edit a markdown file that benefits from rendered preview (plans, design docs, READMEs with tables/diagrams, long docs), put it in scope **once** before the first write.

## Tool

Use MCP server **markdown-mcp**:

```
scope_markdown({ path: "<absolute or workspace-relative .md path>" })
```

- Call **before first write** (the file may not exist yet).
- Call **at most once per path** per session unless the path changed.
- Do **not** call again for ordinary edits — the hub reloads from disk.
- Do **not** open browsers yourself; the hub owns that.
- Prefer absolute paths when you know them.

## Do not

- Spam scope/reload tools
- Scope unrelated files
- Scope secrets or paths outside the user's project without need

## After scoping

Write the markdown with the normal edit tools. The user sees live updates in MarkdownMCP tabs (unread dots, optional change highlights, history).
