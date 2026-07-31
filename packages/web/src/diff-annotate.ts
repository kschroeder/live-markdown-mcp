import type { DiffHunk } from "@markdown-mcp/shared";

/**
 * Mark changed lines for the UI — never inject HTML inside fenced code blocks
 * (breaks mermaid / syntax fences and causes layout NaNs).
 */
export function annotateSourceForMd(source: string, hunks: DiffHunk[]): string {
  const lines = source.split(/\r?\n/);
  const mark = new Map<number, "add" | "mod">();
  const dels: { at: number; lines: string[] }[] = [];
  const inFence = buildFenceMask(lines);

  for (const h of hunks) {
    if (h.type === "add") {
      for (let i = 0; i < h.newLines.length; i++) mark.set(h.newStart + i, "add");
    } else if (h.type === "mod") {
      for (let i = 0; i < h.newLines.length; i++) mark.set(h.newStart + i, "mod");
      if (h.oldLines.length) dels.push({ at: h.newStart, lines: h.oldLines });
    } else if (h.type === "del") {
      dels.push({ at: h.newStart, lines: h.oldLines });
    }
  }

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!inFence[i]) {
      const dlist = dels.filter((d) => d.at === i);
      for (const d of dlist) {
        for (const dl of d.lines) {
          out.push(`<div class="diff-line diff-del">${escapeHtml(dl)}</div>`);
        }
      }
    }

    const m = !inFence[i] ? mark.get(i) : undefined;
    if (m) {
      out.push(`<div class="diff-line diff-${m}">`);
      out.push(lines[i] ?? "");
      out.push(`</div>`);
    } else {
      out.push(lines[i] ?? "");
    }
  }
  for (const d of dels.filter((x) => x.at >= lines.length)) {
    for (const dl of d.lines) {
      out.push(`<div class="diff-line diff-del">${escapeHtml(dl)}</div>`);
    }
  }
  return out.join("\n");
}

/** True for lines inside a ``` fence (including the fence lines themselves). */
export function buildFenceMask(lines: string[]): boolean[] {
  const mask = new Array(lines.length).fill(false);
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? "").trim();
    if (t.startsWith("```")) {
      mask[i] = true;
      open = !open;
      continue;
    }
    if (open) mask[i] = true;
  }
  return mask;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
