import { describe, expect, it } from "vitest";
import { type Change, type ChangeSideContent, type DiffSide, makeChange } from "../diff/change.js";
import { buildPartition, isSplitCandidate } from "./partition.js";
import type { SplitBoundary } from "./wire.js";

/** A single-sided change on `side` spanning [start, end], one synthetic diff line per range line. */
function change(start: number, end: number, side: DiffSide = "head"): Change {
  const marker = side === "head" ? "+" : "-";
  const content: ChangeSideContent = {
    range: { start, end },
    lines: Array.from({ length: end - start + 1 }, (_, i) => `${marker}line ${start + i}`),
  };
  return {
    id: `src/x.ts:${side}:${start}-${end}`,
    path: "src/x.ts",
    ...(side === "head" ? { head: content } : { base: content }),
  };
}

/** A modification whose base spans [1, baseCount] and head [1, headCount], distinct line texts. */
function modChange(baseCount: number, headCount: number): Change {
  return makeChange("src/x.ts", {
    base: {
      range: { start: 1, end: baseCount },
      lines: Array.from({ length: baseCount }, (_, i) => `-base ${i + 1}`),
    },
    head: {
      range: { start: 1, end: headCount },
      lines: Array.from({ length: headCount }, (_, i) => `+head ${i + 1}`),
    },
  });
}

const sideOf = (c: Change): ChangeSideContent => (c.head ?? c.base) as ChangeSideContent;
const head = (n: number): SplitBoundary => ({ head: n });
const base = (n: number): SplitBoundary => ({ base: n });

describe("isSplitCandidate", () => {
  it("is true only when the total line count exceeds the threshold", () => {
    expect(isSplitCandidate(change(1, 120), 120)).toBe(false);
    expect(isSplitCandidate(change(1, 121), 120)).toBe(true);
  });

  it("counts both sides of a modification", () => {
    expect(isSplitCandidate(modChange(60, 70), 120)).toBe(true); // 130 > 120
    expect(isSplitCandidate(modChange(60, 60), 120)).toBe(false); // 120, not >
  });
});

describe("buildPartition — single-sided", () => {
  it("returns the change unchanged when there are no boundaries", () => {
    const c = change(10, 20);
    expect(buildPartition(c, [])).toEqual([c]);
  });

  it("splits a large addition at a mid boundary (regression: single-sided still splits)", () => {
    const parts = buildPartition(change(10, 20), [head(15)]);
    expect(parts.map((p) => [p.id, sideOf(p).range])).toEqual([
      ["src/x.ts:head:10-14", { start: 10, end: 14 }],
      ["src/x.ts:head:15-20", { start: 15, end: 20 }],
    ]);
  });

  it("slices a base-side change from its base boundary", () => {
    const parts = buildPartition(change(50, 60, "base"), [base(55)]);
    expect(parts.map((p) => [p.id, sideOf(p).range, sideOf(p).lines[0]])).toEqual([
      ["src/x.ts:base:50-54", { start: 50, end: 54 }, "-line 50"],
      ["src/x.ts:base:55-60", { start: 55, end: 60 }, "-line 55"],
    ]);
  });

  it("ignores a boundary carrying the wrong side", () => {
    // A head change with only base coordinates → nothing usable → whole.
    const c = change(10, 20);
    expect(buildPartition(c, [base(15)])).toEqual([c]);
  });

  it("drops out-of-range and non-integer points, normalizes order and duplicates", () => {
    const parts = buildPartition(change(10, 20), [head(21), head(17), head(13), head(13), head(5)]);
    expect(parts.map((p) => sideOf(p).range)).toEqual([
      { start: 10, end: 12 },
      { start: 13, end: 16 },
      { start: 17, end: 20 },
    ]);
  });

  it("reconstructs the original exactly: sub-change lines concatenate back and ranges tile", () => {
    const c = change(100, 200);
    const parts = buildPartition(c, [head(120), head(121), head(175)]);
    expect(parts.flatMap((p) => sideOf(p).lines)).toEqual(sideOf(c).lines);
    expect(sideOf(parts[0] as Change).range.start).toBe(100);
    expect(sideOf(parts.at(-1) as Change).range.end).toBe(200);
    for (let i = 1; i < parts.length; i++) {
      expect(sideOf(parts[i] as Change).range.start).toBe(
        sideOf(parts[i - 1] as Change).range.end + 1,
      );
    }
  });
});

describe("buildPartition — modification (two-axis)", () => {
  it("passes a modification through whole when there are no usable boundaries", () => {
    const c = modChange(3, 2);
    expect(buildPartition(c, [])).toEqual([c]);
  });

  it("tiles both axes exactly from paired boundaries (reconstructs each side)", () => {
    const c = modChange(10, 8);
    const parts = buildPartition(c, [
      { base: 4, head: 3 },
      { base: 7, head: 6 },
    ]);

    expect(parts).toHaveLength(3);
    // Both axes tile exactly: concatenated sub-change lines equal the originals.
    expect(parts.flatMap((p) => p.base?.lines ?? [])).toEqual(c.base?.lines);
    expect(parts.flatMap((p) => p.head?.lines ?? [])).toEqual(c.head?.lines);
    // Every segment has both sides → a modification.
    for (const part of parts) {
      expect(part.base).toBeDefined();
      expect(part.head).toBeDefined();
    }
    expect(parts.map((p) => [p.base?.range, p.head?.range])).toEqual([
      [
        { start: 1, end: 3 },
        { start: 1, end: 2 },
      ],
      [
        { start: 4, end: 6 },
        { start: 3, end: 5 },
      ],
      [
        { start: 7, end: 10 },
        { start: 6, end: 8 },
      ],
    ]);
  });

  it("assigns each modification segment a mod id", () => {
    const parts = buildPartition(modChange(4, 4), [{ base: 3, head: 3 }]);
    expect(parts.map((p) => p.id)).toEqual(["src/x.ts:mod:1-2:1-2", "src/x.ts:mod:3-4:3-4"]);
  });

  it("drops boundaries missing a side, out of range, or not strictly advancing on both axes", () => {
    const c = modChange(4, 4);
    const parts = buildPartition(c, [
      base(2), // missing head → dropped
      { base: 3, head: 3 }, // kept
      { base: 5, head: 5 }, // out of range → dropped
      { base: 4, head: 3 }, // head not advancing past 3 → dropped
    ]);
    // Only {3,3} survives → two segments.
    expect(parts.map((p) => [p.base?.range, p.head?.range])).toEqual([
      [
        { start: 1, end: 2 },
        { start: 1, end: 2 },
      ],
      [
        { start: 3, end: 4 },
        { start: 3, end: 4 },
      ],
    ]);
  });
});
