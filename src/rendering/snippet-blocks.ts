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

/** An inclusive range of whole-file row indices — not line numbers — a control can reveal
 * (docs/adr/0021). Gaps never overlap a region's row range or each other; see the cursor in
 * `assembleBlock`. */
export interface SnippetGap {
  fromRow: number;
  toRow: number;
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
  embeddable: boolean;
  open: boolean;
}

/** The block's regions alone, in file order. */
export function blockRegions(block: SnippetBlock): SnippetRegion[] {
  return block.items.flatMap((item) => (item.kind === "region" ? [item.region] : []));
}

export type SnippetPiece =
  | { kind: "block"; block: SnippetBlock }
  /** `reason` is plain text for the renderer to escape. */
  | { kind: "fallback"; ref: SnippetRef; reason: string };

/**
 * Turns a run of refs (consecutive in the markdown, all to one path — ./markdown.ts groups them)
 * into the pieces to render: normally one block. The run splits at a ref whose lines aren't in
 * the diff (a fallback notice in its place) and at a ref whose line ranges overlap an earlier
 * ref's, so the same lines are never drawn twice; pieces on either side of a split do not
 * re-merge. A path with no diff data yields a fallback per ref.
 */
export function buildSnippetPieces(
  refs: SnippetRef[],
  fileDiffs: Map<string, FileDiffData>,
  forceCollapsed: boolean,
): SnippetPiece[] {
  const first = refs[0];
  if (!first) {
    return [];
  }
  const data = fileDiffs.get(first.path);
  if (!data) {
    return refs.map(
      (ref): SnippetPiece => ({
        kind: "fallback",
        ref,
        reason: `${ref.path} could not be loaded.`,
      }),
    );
  }

  const pieces: SnippetPiece[] = [];
  let pending: SnippetRegion[] = [];
  const flush = () => {
    if (pending.length > 0) {
      pieces.push({
        kind: "block",
        block: assembleBlock(first.path, pending, data, forceCollapsed),
      });
    }
    pending = [];
  };

  for (const ref of refs) {
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
    if (pending.some((earlier) => refsOverlap(earlier.ref, ref))) {
      flush();
    }
    pending.push(region);
  }
  flush();
  return pieces;
}

function buildRegion(ref: SnippetRef, rows: AlignedRow[]): SnippetRegion | undefined {
  const baseLines = ref.base ? sideLines(rows, "base", ref.base) : [];
  const headLines = ref.head ? sideLines(rows, "head", ref.head) : [];
  const firstRow = rows.findIndex((row) => rowHoldsRef(row, ref));
  if (firstRow === -1) {
    return undefined;
  }
  return {
    ref,
    rows: buildRegionDiff(baseLines, ref.base?.start ?? 1, headLines, ref.head?.start ?? 1),
    firstRow,
    lastRow: rows.findLastIndex((row) => rowHoldsRef(row, ref)),
    lines: Math.max(baseLines.length, headLines.length),
  };
}

function assembleBlock(
  path: string,
  regions: SnippetRegion[],
  data: FileDiffData,
  forceCollapsed: boolean,
): SnippetBlock {
  // A stable sort keeps document order for regions starting on the same row.
  const sorted = [...regions].sort((a, b) => a.firstRow - b.firstRow);

  // A running cursor, not `previous.lastRow + 1`: row ranges of neighbouring regions may overlap
  // (split pieces straddle paired rows) or nest, and a gap must never re-expose a region's rows.
  const items: SnippetItem[] = [];
  let nextRow = 0;
  sorted.forEach((region, index) => {
    pushGap(items, nextRow, region.firstRow - 1, index === 0 ? "top" : "between", data.embeddable);
    items.push({ kind: "region", region });
    nextRow = Math.max(nextRow, region.lastRow + 1);
  });
  pushGap(items, nextRow, data.rows.length - 1, "bottom", data.embeddable);

  return {
    path,
    paneMode: paneModeForRows(data.rows),
    items,
    embeddable: data.embeddable,
    open: regions.some((region) => region.ref.unfold) && !forceCollapsed,
  };
}

/** Adds a gap item when the range is non-empty; over the embed cap only between-gaps remain,
 * since the file's rows aren't on the page to reveal anything above or below. */
function pushGap(
  items: SnippetItem[],
  fromRow: number,
  toRow: number,
  position: GapPosition,
  embeddable: boolean,
): void {
  if (fromRow > toRow) {
    return;
  }
  if (!embeddable && position !== "between") {
    return;
  }
  items.push({ kind: "gap", gap: { fromRow, toRow, position } });
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
