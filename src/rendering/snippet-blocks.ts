import type { LineRange } from "../diff/change.js";
import type { SnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { type AlignedRow, buildRegionDiff } from "./line-diff.js";

/** Which side(s) of a diff row are drawn: both (github split style), or one side's cells only. */
export type SnippetPaneMode = "split" | "head-only" | "base-only";

/** Where a hidden range sits relative to the block's regions. */
export type GapPosition = "top" | "between" | "bottom";

/** One ref's lines, aligned on their own (docs/adr/0018), plus where they sit in the whole-file
 * rows. `firstRow`/`lastRow` span both sides: every whole-file row holding a referenced line is
 * inside [firstRow, lastRow], so no referenced line can resurface in a gap. */
export interface SnippetRegion {
  ref: SnippetRef;
  rows: AlignedRow[];
  firstRow: number;
  lastRow: number;
  /** The longer side's line count; the summary's per-region size. */
  lines: number;
}

/** An inclusive range of whole-file row indices a control can reveal (docs/adr/0021). */
export interface SnippetGap {
  from: number;
  to: number;
  position: GapPosition;
}

export type SnippetItem =
  | { kind: "region"; region: SnippetRegion }
  | { kind: "gap"; gap: SnippetGap };

/** One rendered snippet block: regions in file order with the hidden ranges between them. */
export interface SnippetBlock {
  path: string;
  paneMode: SnippetPaneMode;
  /** Regions and non-empty gaps, in render order. */
  items: SnippetItem[];
  /** The regions alone, in file order. */
  regions: SnippetRegion[];
  embeddable: boolean;
  open: boolean;
}

export type SnippetPiece =
  | { kind: "block"; block: SnippetBlock }
  | { kind: "fallback"; ref: SnippetRef; reason: string };

/**
 * Turns a run of refs (consecutive in the markdown, same path — see ./markdown.ts) into the
 * pieces to render: normally one block. The run splits at a ref that can't be rendered (a
 * fallback notice in its place) and at a ref whose line ranges overlap an earlier ref's, so the
 * same lines are never drawn twice; pieces on either side of a split do not re-merge.
 */
export function buildSnippetPieces(
  refs: SnippetRef[],
  fileDiffs: Map<string, FileDiffData>,
  forceCollapsed: boolean,
): SnippetPiece[] {
  const pieces: SnippetPiece[] = [];
  let current: SnippetRegion[] = [];
  let currentData: FileDiffData | undefined;

  const flush = () => {
    if (current.length > 0 && currentData) {
      pieces.push({ kind: "block", block: assembleBlock(current, currentData, forceCollapsed) });
    }
    current = [];
    currentData = undefined;
  };

  for (const ref of refs) {
    const data = fileDiffs.get(ref.path);
    if (!data) {
      flush();
      pieces.push({ kind: "fallback", ref, reason: `${ref.path} could not be loaded.` });
      continue;
    }
    const region = buildRegion(ref, data.rows);
    if (!region) {
      flush();
      pieces.push({
        kind: "fallback",
        ref,
        reason: "The referenced lines could not be located in the diff.",
      });
      continue;
    }
    if (current.some((earlier) => refsOverlap(earlier.ref, ref))) {
      flush();
    }
    current.push(region);
    currentData = data;
  }
  flush();
  return pieces;
}

function buildRegion(ref: SnippetRef, rows: AlignedRow[]): SnippetRegion | undefined {
  const baseLines = ref.base ? sideLines(rows, "base", ref.base) : [];
  const headLines = ref.head ? sideLines(rows, "head", ref.head) : [];
  if (baseLines.length === 0 && headLines.length === 0) {
    return undefined;
  }
  let firstRow = -1;
  let lastRow = -1;
  rows.forEach((row, index) => {
    if (rowHoldsRef(row, ref)) {
      if (firstRow === -1) {
        firstRow = index;
      }
      lastRow = index;
    }
  });
  if (firstRow === -1) {
    return undefined;
  }
  return {
    ref,
    rows: buildRegionDiff(baseLines, ref.base?.start ?? 1, headLines, ref.head?.start ?? 1),
    firstRow,
    lastRow,
    lines: Math.max(baseLines.length, headLines.length),
  };
}

function assembleBlock(
  regions: SnippetRegion[],
  data: FileDiffData,
  forceCollapsed: boolean,
): SnippetBlock {
  const sorted = regions
    .map((region, order) => ({ region, order }))
    .sort((a, b) => a.region.firstRow - b.region.firstRow || a.order - b.order)
    .map((entry) => entry.region);

  // A running cursor, not `previous.lastRow + 1`: row ranges of neighbouring regions may overlap
  // (split pieces straddle paired rows) or nest, and a gap must never re-expose a region's rows.
  const items: SnippetItem[] = [];
  let next = 0;
  sorted.forEach((region, index) => {
    pushGap(items, next, region.firstRow - 1, index === 0 ? "top" : "between", data.embeddable);
    items.push({ kind: "region", region });
    next = Math.max(next, region.lastRow + 1);
  });
  pushGap(items, next, data.rows.length - 1, "bottom", data.embeddable);

  return {
    path: sorted[0]?.ref.path ?? "",
    paneMode: paneModeForRows(data.rows),
    items,
    regions: sorted,
    embeddable: data.embeddable,
    open: sorted.some((region) => region.ref.unfold) && !forceCollapsed,
  };
}

/** Adds a gap item when the range is non-empty; over the embed cap only between-gaps remain,
 * since the file's rows aren't on the page to reveal anything above or below. */
function pushGap(
  items: SnippetItem[],
  from: number,
  to: number,
  position: GapPosition,
  embeddable: boolean,
): void {
  if (from > to) {
    return;
  }
  if (!embeddable && position !== "between") {
    return;
  }
  items.push({ kind: "gap", gap: { from, to, position } });
}

/** Single-pane only when the whole file is single-sided: a single-pane row renders no cells for
 * the other side, so anything revealed from a two-sided file would come out blank. */
function paneModeForRows(rows: AlignedRow[]): SnippetPaneMode {
  if (rows.every((row) => row.baseLine === null)) {
    return "head-only";
  }
  if (rows.every((row) => row.headLine === null)) {
    return "base-only";
  }
  return "split";
}

function rowHoldsRef(row: AlignedRow, ref: SnippetRef): boolean {
  return (
    (ref.base !== undefined && row.baseLine !== null && inRange(row.baseLine, ref.base)) ||
    (ref.head !== undefined && row.headLine !== null && inRange(row.headLine, ref.head))
  );
}

function refsOverlap(a: SnippetRef, b: SnippetRef): boolean {
  return rangesIntersect(a.base, b.base) || rangesIntersect(a.head, b.head);
}

function rangesIntersect(a: LineRange | undefined, b: LineRange | undefined): boolean {
  return a !== undefined && b !== undefined && a.start <= b.end && b.start <= a.end;
}

function inRange(line: number, range: LineRange): boolean {
  return line >= range.start && line <= range.end;
}

/** The `side`'s text lines whose line number falls within `range`, in file order. */
function sideLines(rows: AlignedRow[], side: "base" | "head", range: LineRange): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const lineNo = side === "base" ? row.baseLine : row.headLine;
    const text = side === "base" ? row.baseText : row.headText;
    if (lineNo !== null && text !== null && inRange(lineNo, range)) {
      out.push(text);
    }
  }
  return out;
}
