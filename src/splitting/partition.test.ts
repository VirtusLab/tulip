import { describe, expect, it } from "vitest";
import type { Change, ChangeSideContent, DiffSide } from "../diff/change.js";
import { buildPartition, isSplitCandidate } from "./partition.js";

/** A single-sided change on `side` spanning [start, end], with one synthetic diff line per range
 * line so slicing offsets can be checked against content. */
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

/** The present side's content of a single-sided sub-change. */
function sideOf(c: Change): ChangeSideContent {
  return (c.head ?? c.base) as ChangeSideContent;
}

describe("isSplitCandidate", () => {
  it("is true only when the total line count exceeds the threshold", () => {
    expect(isSplitCandidate(change(1, 120), 120)).toBe(false); // exactly 120 lines
    expect(isSplitCandidate(change(1, 121), 120)).toBe(true); // 121 lines
  });

  it("counts both sides of a modification", () => {
    const modification: Change = {
      id: "src/x.ts:mod:1-60:1-70",
      path: "src/x.ts",
      base: { range: { start: 1, end: 60 }, lines: Array.from({ length: 60 }, () => "-x") },
      head: { range: { start: 1, end: 70 }, lines: Array.from({ length: 70 }, () => "+y") },
    };
    expect(isSplitCandidate(modification, 120)).toBe(true); // 60 + 70 = 130 > 120
  });
});

describe("buildPartition", () => {
  it("returns the change unchanged when there are no split points", () => {
    const c = change(10, 20);
    expect(buildPartition(c, [])).toEqual([c]);
  });

  it("passes a modification through whole (two-axis splitting is a later step)", () => {
    const modification: Change = {
      id: "src/x.ts:mod:1-3:1-2",
      path: "src/x.ts",
      base: { range: { start: 1, end: 3 }, lines: ["-a", "-b", "-c"] },
      head: { range: { start: 1, end: 2 }, lines: ["+x", "+y"] },
    };
    expect(buildPartition(modification, [2])).toEqual([modification]);
  });

  it("drops a point equal to range.start (no interior segment there)", () => {
    const c = change(10, 20);
    expect(buildPartition(c, [10])).toEqual([c]);
  });

  it("accepts a point equal to range.end, yielding a 1-line tail", () => {
    const parts = buildPartition(change(10, 20), [20]);
    expect(parts.map((p) => sideOf(p).range)).toEqual([
      { start: 10, end: 19 },
      { start: 20, end: 20 },
    ]);
    expect(sideOf(parts[1] as Change).lines).toEqual(["+line 20"]);
  });

  it("handles adjacent points p and p+1", () => {
    const parts = buildPartition(change(10, 20), [14, 15]);
    expect(parts.map((p) => sideOf(p).range)).toEqual([
      { start: 10, end: 13 },
      { start: 14, end: 14 },
      { start: 15, end: 20 },
    ]);
  });

  it("splits at a mid point, assigning new-shape ids", () => {
    const parts = buildPartition(change(10, 20), [15]);
    expect(parts.map((p) => [p.id, sideOf(p).range])).toEqual([
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
    expect(parts.map((p) => sideOf(p).range)).toEqual([
      { start: 10, end: 12 },
      { start: 13, end: 16 },
      { start: 17, end: 20 },
    ]);
  });

  it("drops non-integer points", () => {
    const parts = buildPartition(change(10, 20), [15.5, 15]);
    expect(parts.map((p) => sideOf(p).range)).toEqual([
      { start: 10, end: 14 },
      { start: 15, end: 20 },
    ]);
  });

  it("reconstructs the original exactly: sub-change lines concatenate back and ranges tile", () => {
    const c = change(100, 200);
    const parts = buildPartition(c, [120, 121, 175]);

    // Every line present exactly once, in order.
    expect(parts.flatMap((p) => sideOf(p).lines)).toEqual(sideOf(c).lines);
    // Ranges tile [start, end] with no gap or overlap.
    expect(sideOf(parts[0] as Change).range.start).toBe(sideOf(c).range.start);
    expect(sideOf(parts.at(-1) as Change).range.end).toBe(sideOf(c).range.end);
    for (let i = 1; i < parts.length; i++) {
      expect(sideOf(parts[i] as Change).range.start).toBe(
        sideOf(parts[i - 1] as Change).range.end + 1,
      );
    }
    // Each sub-change's line count matches its range.
    for (const p of parts) {
      const s = sideOf(p);
      expect(s.lines).toHaveLength(s.range.end - s.range.start + 1);
    }
  });

  it("slices a base-side change identically", () => {
    const parts = buildPartition(change(50, 60, "base"), [55]);
    expect(parts.map((p) => [p.id, sideOf(p).range, sideOf(p).lines[0]])).toEqual([
      ["src/x.ts:base:50-54", { start: 50, end: 54 }, "-line 50"],
      ["src/x.ts:base:55-60", { start: 55, end: 60 }, "-line 55"],
    ]);
  });
});
