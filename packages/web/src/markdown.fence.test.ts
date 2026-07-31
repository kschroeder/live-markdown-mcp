import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { annotateSourceForMd, buildFenceMask } from "./diff-annotate.ts";
import type { DiffHunk } from "@markdown-mcp/shared";

describe("fence-safe diff annotation", () => {
  it("marks lines inside ``` as in-fence", () => {
    const lines = ["# t", "```mermaid", "A --> B", "```", "after"];
    const mask = buildFenceMask(lines);
    assert.deepEqual(mask, [false, true, true, true, false]);
  });

  it("does not inject diff HTML inside mermaid fences", () => {
    const source = [
      "# Title",
      "",
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
      "",
      "### After diagram",
      "Visible tail",
    ].join("\n");

    const hunks: DiffHunk[] = [
      {
        type: "add",
        oldStart: 0,
        oldLines: [],
        newStart: 0,
        newLines: source.split("\n"),
      },
    ];

    const annotated = annotateSourceForMd(source, hunks);
    // Fence body stays plain
    assert.match(annotated, /```mermaid\nflowchart LR\n {2}A --> B\n```/);
    assert.doesNotMatch(
      annotated.split("```mermaid")[1]!.split("```")[0]!,
      /diff-line/
    );
    // Content after fence can still be marked
    assert.match(annotated, /diff-add/);
    assert.match(annotated, /After diagram/);
  });
});
