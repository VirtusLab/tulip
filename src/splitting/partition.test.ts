import { describe, expect, it } from "vitest";
import type { Change, DiffSide } from "../diff/change.js";
import { buildPartition, isSplitCandidate } from "./partition.js";

/** A change on `side` spanning [start, end], with one synthetic diff line per range line so
 * slicing offsets can be checked against content. */
function change(start: number, end: number, side: DiffSide = "head"): Change {
  const marker = side === "head" ? "+" : "-";
  const lines = Array.from({ length: end - start + 1 }, (_, i) => `${marker}line ${start + i}`);
  return {
    id: `src/x.ts:${side}:${start}-${end}`,
    path: "src/x.ts",
    side,
    range: { start, end },
    lines,
  };
}

describe("isSplitCandidate", () => {
  it("is true only when the line count exceeds the threshold", () => {
    expect(isSplitCandidate(change(1, 120), 120)).toBe(false); // exactly 120 lines
    expect(isSplitCandidate(change(1, 121), 120)).toBe(true); // 121 lines
  });
});

describe("buildPartition", () => {
  it("returns the change unchanged when there are no split points", () => {
    const c = change(10, 20);
    expect(buildPartition(c, [])).toEqual([c]);
  });

  it("drops a point equal to range.start (no interior segment there)", () => {
    const c = change(10, 20);
    expect(buildPartition(c, [10])).toEqual([c]);
  });

  it("accepts a point equal to range.end, yielding a 1-line tail", () => {
    const parts = buildPartition(change(10, 20), [20]);
    expect(parts.map((p) => p.range)).toEqual([
      { start: 10, end: 19 },
      { start: 20, end: 20 },
    ]);
    expect(parts[1]?.lines).toEqual(["+line 20"]);
  });

  it("handles adjacent points p and p+1", () => {
    const parts = buildPartition(change(10, 20), [14, 15]);
    expect(parts.map((p) => p.range)).toEqual([
      { start: 10, end: 13 },
      { start: 14, end: 14 },
      { start: 15, end: 20 },
    ]);
  });

  it("splits at a mid point", () => {
    const parts = buildPartition(change(10, 20), [15]);
    expect(parts.map((p) => [p.id, p.range])).toEqual([
      ["src/x.ts:head:10-14", { start: 10, end: 14 }],
      ["src/x.ts:head:15-20", { start: 15, end: 20 }],
    ]);
  });

  it("drops out-of-range points", () => {
    const c = change(10, 20);
    expect(buildPartition(c, [5, 21, 100, -3])).toEqual([c]);
  });

  it("normalizes unsorted and duplicate points", () => {
    const parts = buildPartition(change(10, 20), [17, 13, 17, 13]);
    expect(parts.map((p) => p.range)).toEqual([
      { start: 10, end: 12 },
      { start: 13, end: 16 },
      { start: 17, end: 20 },
    ]);
  });

  it("drops non-integer points", () => {
    const parts = buildPartition(change(10, 20), [15.5, 15]);
    expect(parts.map((p) => p.range)).toEqual([
      { start: 10, end: 14 },
      { start: 15, end: 20 },
    ]);
  });

  it("reconstructs the original exactly: sub-change lines concatenate back and ranges tile", () => {
    const c = change(100, 200);
    const parts = buildPartition(c, [120, 121, 175]);

    // Every line present exactly once, in order.
    expect(parts.flatMap((p) => p.lines)).toEqual(c.lines);
    // Ranges tile [start, end] with no gap or overlap.
    expect(parts[0]?.range.start).toBe(c.range.start);
    expect(parts.at(-1)?.range.end).toBe(c.range.end);
    for (let i = 1; i < parts.length; i++) {
      expect((parts[i] as Change).range.start).toBe((parts[i - 1] as Change).range.end + 1);
    }
    // Each sub-change's line count matches its range.
    for (const p of parts) {
      expect(p.lines).toHaveLength(p.range.end - p.range.start + 1);
    }
  });

  it("slices a base-side change identically", () => {
    const parts = buildPartition(change(50, 60, "base"), [55]);
    expect(parts.map((p) => [p.id, p.range, p.lines[0]])).toEqual([
      ["src/x.ts:base:50-54", { start: 50, end: 54 }, "-line 50"],
      ["src/x.ts:base:55-60", { start: 55, end: 60 }, "-line 55"],
    ]);
  });
});
