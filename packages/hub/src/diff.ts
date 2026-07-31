import { diffLines } from "diff";
import type { DiffHunk } from "@markdown-mcp/shared";

export function computeHunks(oldText: string, newText: string): DiffHunk[] {
  if (oldText === newText) {
    return [];
  }
  const parts = diffLines(oldText, newText);
  const hunks: DiffHunk[] = [];
  let newLine = 0;
  let oldLine = 0;

  let i = 0;
  while (i < parts.length) {
    const part = parts[i]!;
    const lines = splitKeep(part.value);

    if (part.added && i + 1 < parts.length && parts[i + 1]!.removed) {
      // treat as mod: added then removed is unusual order; handle swap below
    }

    if (part.removed && i + 1 < parts.length && parts[i + 1]!.added) {
      const next = parts[i + 1]!;
      const oldLines = splitKeep(part.value);
      const newLines = splitKeep(next.value);
      hunks.push({
        type: "mod",
        oldStart: oldLine,
        oldLines,
        newStart: newLine,
        newLines,
      });
      oldLine += oldLines.length;
      newLine += newLines.length;
      i += 2;
      continue;
    }

    if (part.added) {
      hunks.push({
        type: "add",
        oldStart: oldLine,
        oldLines: [],
        newStart: newLine,
        newLines: lines,
      });
      newLine += lines.length;
    } else if (part.removed) {
      hunks.push({
        type: "del",
        oldStart: oldLine,
        oldLines: lines,
        newStart: newLine,
        newLines: [],
      });
      oldLine += lines.length;
    } else {
      // equal lines — skip storing full eq hunks for payload size; only count position
      newLine += lines.length;
      oldLine += lines.length;
    }
    i += 1;
  }

  return hunks;
}

export function hunkStats(hunks: DiffHunk[]): { add: number; del: number; mod: number } {
  let add = 0;
  let del = 0;
  let mod = 0;
  for (const h of hunks) {
    if (h.type === "add") add += h.newLines.length || 1;
    else if (h.type === "del") del += h.oldLines.length || 1;
    else if (h.type === "mod") mod += Math.max(h.newLines.length, h.oldLines.length, 1);
  }
  return { add, del, mod };
}

function splitKeep(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  // diffLines often ends with trailing newline → empty last element
  if (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
