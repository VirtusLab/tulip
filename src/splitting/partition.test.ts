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
const head = (line: number): SplitBoundary => ({ side: "head", line });
const base = (line: number): SplitBoundary => ({ side: "base", line });
/** The derived kind of a change: modification (both sides), addition (head), or deletion (base). */
const kindOf = (c: Change): "mod" | "add" | "del" =>
  c.base && c.head ? "mod" : c.head ? "add" : "del";

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
    // A head-only change with a base-side boundary → nothing usable → whole.
    const c = change(10, 20);
    expect(buildPartition(c, [base(15)])).toEqual([c]);
  });

  it("drops out-of-range, non-integer and duplicate points, normalizing order", () => {
    const parts = buildPartition(change(10, 20), [
      head(21), // > end → dropped
      head(17),
      head(13),
      head(13), // duplicate
      head(5), // < start → dropped
      head(15.5), // non-integer → dropped
    ]);
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

describe("buildPartition — modification (single-axis cut)", () => {
  it("passes a modification through whole when there are no usable boundaries", () => {
    const c = modChange(3, 2);
    expect(buildPartition(c, [])).toEqual([c]);
  });

  it("cuts inside the head run → a modification then an addition", () => {
    // base 1-3, head 1-4; cut before head line 3 keeps head 1-2 with the deletions.
    const parts = buildPartition(modChange(3, 4), [head(3)]);
    expect(parts.map((p) => [p.id, kindOf(p)])).toEqual([
      ["src/x.ts:mod:1-3:1-2", "mod"],
      ["src/x.ts:head:3-4", "add"],
    ]);
  });

  it("cuts inside the base run → a deletion then a modification", () => {
    // base 1-4, head 1-3; cut before base line 3 leaves base 1-2 as a pure deletion.
    const parts = buildPartition(modChange(4, 3), [base(3)]);
    expect(parts.map((p) => [p.id, kindOf(p)])).toEqual([
      ["src/x.ts:base:1-2", "del"],
      ["src/x.ts:mod:3-4:1-3", "mod"],
    ]);
  });

  it("keeps the junction cut {head, headStart} → a deletion then an addition (Issue #1 guardrail)", () => {
    // The head's first line is a legal, non-first boundary: it peels the deletions off.
    const parts = buildPartition(modChange(3, 4), [head(1)]);
    expect(parts.map((p) => [p.id, kindOf(p)])).toEqual([
      ["src/x.ts:base:1-3", "del"],
      ["src/x.ts:head:1-4", "add"],
    ]);
  });

  it("cuts on both a base and a head line → deletion, modification, addition", () => {
    const parts = buildPartition(modChange(4, 4), [base(3), head(3)]);
    expect(parts.map((p) => [p.id, kindOf(p)])).toEqual([
      ["src/x.ts:base:1-2", "del"],
      ["src/x.ts:mod:3-4:1-2", "mod"],
      ["src/x.ts:head:3-4", "add"],
    ]);
  });

  it("is uncapped: three pieces from a base-2 / head-30 change (no shorter-side cap)", () => {
    // The old two-axis splitter capped segment count at the shorter side (2 base lines → 2
    // segments max). The single-axis cut has no such cap.
    const parts = buildPartition(modChange(2, 30), [head(10), head(20)]);
    expect(parts.map((p) => [p.id, kindOf(p)])).toEqual([
      ["src/x.ts:mod:1-2:1-9", "mod"],
      ["src/x.ts:head:10-19", "add"],
      ["src/x.ts:head:20-30", "add"],
    ]);
  });

  it("reconstructs both axes exactly: slice base lines rebuild the base, head the head", () => {
    const c = modChange(5, 6);
    const parts = buildPartition(c, [base(3), head(2), head(5)]);
    expect(parts.flatMap((p) => p.base?.lines ?? [])).toEqual(c.base?.lines);
    expect(parts.flatMap((p) => p.head?.lines ?? [])).toEqual(c.head?.lines);
  });

  it("drops a boundary on an absent side and one out of range", () => {
    const c = modChange(4, 4);
    const parts = buildPartition(c, [
      base(6), // > base end → dropped
      head(5), // > head end → dropped
      head(3), // kept
    ]);
    expect(parts.map((p) => p.id)).toEqual(["src/x.ts:mod:1-4:1-2", "src/x.ts:head:3-4"]);
  });
});
