import { describe, expect, it } from "vitest";
import type { SnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { buildAlignedDiff } from "./line-diff.js";
import { blockRegions, buildSnippetPieces, type SnippetBlock } from "./snippet-blocks.js";

const PATH = "src/a.ts";

function fileDiffs(rows: FileDiffData["rows"]): Map<string, FileDiffData> {
  return new Map([[PATH, { rows, embeddable: true }]]);
}

/** A file of `n` lines `l1..ln`; `modified` lines get their text upper-cased on the head side. */
function modifiedFile(n: number, modified: number[]) {
  const base = Array.from({ length: n }, (_, i) => `l${i + 1}`);
  const head = base.map((line, i) => (modified.includes(i + 1) ? line.toUpperCase() : line));
  return buildAlignedDiff(`${base.join("\n")}\n`, `${head.join("\n")}\n`);
}

function modRef(line: number, unfold = true): SnippetRef {
  return { path: PATH, base: { start: line, end: line }, head: { start: line, end: line }, unfold };
}

function onlyBlock(refs: SnippetRef[], diffs: Map<string, FileDiffData>): SnippetBlock {
  const pieces = buildSnippetPieces(refs, diffs, false);
  expect(pieces).toHaveLength(1);
  const piece = pieces[0];
  if (piece?.kind !== "block") throw new Error("expected a block");
  return piece.block;
}

// The block-structure facts the HTML tests in snippets.test.ts can't state directly: row bounds,
// gap arithmetic, ordering, and run splitting by line-range overlap.
describe("buildSnippetPieces", () => {
  it("bounds a longer-base modification by both sides, so no referenced base line lands in a gap", () => {
    // base 3-5 (three lines) -> head 3 (one line): whole-file rows pair (b3,h3), (b4,-), (b5,-).
    const rows = buildAlignedDiff("l1\nl2\nb3\nb4\nb5\nl6\nl7\n", "l1\nl2\nH3\nl6\nl7\n");
    const ref: SnippetRef = {
      path: PATH,
      base: { start: 3, end: 5 },
      head: { start: 3, end: 3 },
      unfold: true,
    };
    const block = onlyBlock([ref], fileDiffs(rows));
    const region = blockRegions(block)[0];
    expect(region?.firstRow).toBe(2);
    expect(region?.lastRow).toBe(4);
    const bottom = block.items.at(-1);
    expect(bottom?.kind === "gap" && bottom.gap.fromRow).toBe(5);
  });

  it("computes gap ranges as inclusive whole-file row indices", () => {
    const block = onlyBlock([modRef(3), modRef(8)], fileDiffs(modifiedFile(10, [3, 8])));
    const gaps = block.items.flatMap((item) => (item.kind === "gap" ? [item.gap] : []));
    expect(gaps).toEqual([
      { fromRow: 0, toRow: 1, position: "top" },
      { fromRow: 3, toRow: 6, position: "between" },
      { fromRow: 8, toRow: 9, position: "bottom" },
    ]);
  });

  it("orders regions by file position regardless of ref order", () => {
    const block = onlyBlock([modRef(8), modRef(3)], fileDiffs(modifiedFile(10, [3, 8])));
    expect(blockRegions(block).map((r) => r.ref.head?.start)).toEqual([3, 8]);
  });

  it("keeps document order for regions starting on the same row", () => {
    // A deletion ref and an addition ref that share a paired whole-file row (b3,H3).
    const rows = buildAlignedDiff("l1\nl2\nb3\nl4\n", "l1\nl2\nH3\nl4\n");
    const deletion: SnippetRef = { path: PATH, base: { start: 3, end: 3 }, unfold: true };
    const addition: SnippetRef = { path: PATH, head: { start: 3, end: 3 }, unfold: true };
    const sides = (refs: SnippetRef[]) =>
      blockRegions(onlyBlock(refs, fileDiffs(rows))).map((r) => (r.ref.base ? "base" : "head"));
    expect(sides([deletion, addition])).toEqual(["base", "head"]);
    expect(sides([addition, deletion])).toEqual(["head", "base"]);
  });

  it("splits the run at a ref whose line ranges overlap an earlier one", () => {
    const a: SnippetRef = {
      path: PATH,
      base: { start: 3, end: 4 },
      head: { start: 3, end: 4 },
      unfold: true,
    };
    const b: SnippetRef = {
      path: PATH,
      base: { start: 4, end: 5 },
      head: { start: 4, end: 5 },
      unfold: true,
    };
    const pieces = buildSnippetPieces([a, b], fileDiffs(modifiedFile(10, [3, 4, 5])), false);
    expect(pieces.map((p) => p.kind)).toEqual(["block", "block"]);
  });

  it("opens when any ref unfolds, not only when all do", () => {
    const block = onlyBlock(
      [modRef(3, false), modRef(8, true)],
      fileDiffs(modifiedFile(10, [3, 8])),
    );
    expect(block.open).toBe(true);
  });
});
