import { diffLines } from "diff";

/** Which kind of diff cell this is; `null` means the cell is blank (the other side has no
 * corresponding line at this row — e.g. a pure addition has no base-side content). */
export type DiffCellType = "context" | "add" | "remove" | null;

/**
 * One row of a github-style split diff: independent base/head cells, each with its own line
 * number, text and type. A `"context"` row has identical text on both sides; a modified line is
 * one row with a `"remove"` base cell and an `"add"` head cell; a pure insertion/deletion has a
 * blank cell (`null`) on the other side.
 */
export interface AlignedRow {
  baseLine: number | null;
  baseText: string | null;
  baseType: DiffCellType;
  headLine: number | null;
  headText: string | null;
  headType: DiffCellType;
}

/**
 * Builds the full, whole-file side-by-side line alignment between `baseContent` and
 * `headContent`, github split-diff style. Used both to render a `{{snippet}}` marker's initial
 * range (see ./snippets.ts) and, for files under the embed-size cap, to let the client expand
 * more context around it (see ./assets/app.js).
 */
export function buildAlignedDiff(baseContent: string, headContent: string): AlignedRow[] {
  const parts = diffLines(baseContent, headContent);
  const rows: AlignedRow[] = [];
  let baseLine = 1;
  let headLine = 1;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) {
      continue;
    }

    if (!part.added && !part.removed) {
      for (const line of splitLines(part.value)) {
        rows.push({
          baseLine: baseLine++,
          baseText: line,
          baseType: "context",
          headLine: headLine++,
          headText: line,
          headType: "context",
        });
      }
      continue;
    }

    // jsdiff always emits a removed run immediately followed by its paired added run (if any);
    // pair them row-by-row github-split-view style rather than as separate remove-only/add-only
    // blocks, so a one-line edit reads as a single before/after row.
    const removedLines = part.removed ? splitLines(part.value) : [];
    const next = part.removed ? parts[i + 1] : undefined;
    const addedLines = next?.added ? splitLines(next.value) : [];
    if (next?.added) {
      i++;
    } else if (part.added) {
      addedLines.push(...splitLines(part.value));
    }

    const rowCount = Math.max(removedLines.length, addedLines.length);
    for (let k = 0; k < rowCount; k++) {
      const removed = removedLines[k];
      const added = addedLines[k];
      rows.push({
        baseLine: removed !== undefined ? baseLine++ : null,
        baseText: removed ?? null,
        baseType: removed !== undefined ? "remove" : null,
        headLine: added !== undefined ? headLine++ : null,
        headText: added ?? null,
        headType: added !== undefined ? "add" : null,
      });
    }
  }

  return rows;
}

function splitLines(value: string): string[] {
  const withoutTrailingNewline = value.endsWith("\n") ? value.slice(0, -1) : value;
  return withoutTrailingNewline === "" ? [] : withoutTrailingNewline.split("\n");
}
