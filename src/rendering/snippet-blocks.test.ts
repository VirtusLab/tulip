import { describe, expect, it } from "vitest";
import type { SnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { buildAlignedDiff } from "./line-diff.js";
import { buildSnippetPieces, type SnippetBlock } from "./snippet-blocks.js";

const PATH = "src/a.ts";

function fileDiffs(rows: FileDiffData["rows"], embeddable = true): Map<string, FileDiffData> {
  return new Map([[PATH, { rows, embeddable }]]);
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

function kinds(block: SnippetBlock): string[] {
  return block.items.map((item) => (item.kind === "gap" ? `gap:${item.gap.position}` : "region"));
}

describe("buildSnippetPieces — region bounds", () => {
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
    const region = block.regions[0];
    expect(region?.firstRow).toBe(2);
    expect(region?.lastRow).toBe(4);
    const bottom = block.items.at(-1);
    expect(bottom?.kind === "gap" && bottom.gap.from).toBe(5);
  });

  it("treats a ref whose lines are not in the file as a fallback", () => {
    const pieces = buildSnippetPieces([modRef(99)], fileDiffs(modifiedFile(10, [5])), false);
    expect(pieces[0]?.kind).toBe("fallback");
  });
});

describe("buildSnippetPieces — runs", () => {
  it("merges contiguous split pieces with no gap between them", () => {
    const block = onlyBlock([modRef(5), modRef(6)], fileDiffs(modifiedFile(10, [5, 6])));
    expect(kinds(block)).toEqual(["gap:top", "region", "region", "gap:bottom"]);
  });

  it("orders regions by file position regardless of ref order, ties by document order", () => {
    const block = onlyBlock([modRef(8), modRef(3)], fileDiffs(modifiedFile(10, [3, 8])));
    expect(block.regions.map((r) => r.ref.head?.start)).toEqual([3, 8]);
    expect(kinds(block)).toEqual(["gap:top", "region", "gap:between", "region", "gap:bottom"]);
  });

  it("computes gap ranges as inclusive whole-file row indices", () => {
    const block = onlyBlock([modRef(3), modRef(8)], fileDiffs(modifiedFile(10, [3, 8])));
    const gaps = block.items.flatMap((item) => (item.kind === "gap" ? [item.gap] : []));
    expect(gaps).toEqual([
      { from: 0, to: 1, position: "top" },
      { from: 3, to: 6, position: "between" },
      { from: 8, to: 9, position: "bottom" },
    ]);
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

  it("splits the run at a failed ref and does not re-merge across it", () => {
    const pieces = buildSnippetPieces(
      [modRef(3), modRef(99), modRef(8)],
      fileDiffs(modifiedFile(10, [3, 8])),
      false,
    );
    expect(pieces.map((p) => p.kind)).toEqual(["block", "fallback", "block"]);
  });

  it("splits the run at a ref to a different path, even when both load fine", () => {
    const other = "src/b.ts";
    const diffs = new Map<string, FileDiffData>([
      [PATH, { rows: modifiedFile(10, [3]), embeddable: true }],
      [other, { rows: modifiedFile(10, [8]), embeddable: true }],
    ]);
    const refs: SnippetRef[] = [modRef(3), { ...modRef(8), path: other }];
    const pieces = buildSnippetPieces(refs, diffs, false);
    expect(pieces.map((p) => p.kind)).toEqual(["block", "block"]);
  });

  it("makes every ref a fallback when the file has no diff data", () => {
    const pieces = buildSnippetPieces([modRef(3), modRef(8)], new Map(), false);
    expect(pieces.map((p) => p.kind)).toEqual(["fallback", "fallback"]);
  });
});

describe("buildSnippetPieces — pane mode, gaps over the cap, open", () => {
  it("uses head-only for a pure addition file and split for an addition inside a modified file", () => {
    const added = buildAlignedDiff("", "a\nb\nc\n");
    const addRef: SnippetRef = { path: PATH, head: { start: 2, end: 2 }, unfold: true };
    expect(onlyBlock([addRef], fileDiffs(added)).paneMode).toBe("head-only");

    const modifiedWithAdd = buildAlignedDiff("l1\nl2\nl3\n", "l1\nL2\nnew\nl3\n");
    const addInModified: SnippetRef = { path: PATH, head: { start: 3, end: 3 }, unfold: true };
    expect(onlyBlock([addInModified], fileDiffs(modifiedWithAdd)).paneMode).toBe("split");
  });

  it("keeps only between gaps for a file over the embed cap", () => {
    const block = onlyBlock([modRef(3), modRef(8)], fileDiffs(modifiedFile(10, [3, 8]), false));
    expect(kinds(block)).toEqual(["region", "gap:between", "region"]);
    expect(block.embeddable).toBe(false);
  });

  it("opens when any ref unfolds, unless force-collapsed", () => {
    const diffs = fileDiffs(modifiedFile(10, [3, 8]));
    expect(onlyBlock([modRef(3, false), modRef(8, true)], diffs).open).toBe(true);
    expect(onlyBlock([modRef(3, false), modRef(8, false)], diffs).open).toBe(false);
    const forced = buildSnippetPieces([modRef(3, true)], diffs, true)[0];
    expect(forced?.kind === "block" && forced.block.open).toBe(false);
  });
});
