---
name: markdown-scope
description: >-
  Scope markdown files for live browser preview via MarkdownMCP before writing
  or editing plans, design docs, READMEs, or other .md the user will read.
  Use when creating/editing markdown that benefits from rendered preview
  (tables, diagrams, long docs). Triggers: write markdown, plan.md, design doc,
  README, preview markdown, live markdown.
---

# Markdown live preview (MarkdownMCP)

## Rule

Before the **first write** to a markdown file that should be previewed, call:

```
scope_markdown({ path: "<path to .md>" })
```

on the **markdown-mcp** MCP server (tool may appear as `markdown-mcp__scope_markdown` depending on host naming).

## Details

1. Prefer an absolute path; workspace-relative is OK.
2. The file does **not** need to exist yet.
3. Call **once** per path — not on every edit.
4. Then create/edit the file normally. The hub watches disk and updates the UI.
5. Skip for tiny throwaway notes the user will not read rendered.

## Do not

- Re-scope the same path for routine edits
- Launch a browser manually
- Scope every markdown file in the repo
