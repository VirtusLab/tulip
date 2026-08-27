import { describe, expect, it } from "vitest";
import { buildAlignedDiff } from "./line-diff.js";

describe("buildAlignedDiff", () => {
  it("aligns identical content as all-context rows", () => {
    const rows = buildAlignedDiff("a\nb\nc\n", "a\nb\nc\n");
    expect(rows).toEqual([
      {
        baseLine: 1,
        baseText: "a",
        baseType: "context",
        headLine: 1,
        headText: "a",
        headType: "context",
      },
      {
        baseLine: 2,
        baseText: "b",
        baseType: "context",
        headLine: 2,
        headText: "b",
        headType: "context",
      },
      {
        baseLine: 3,
        baseText: "c",
        baseType: "context",
        headLine: 3,
        headText: "c",
        headType: "context",
      },
    ]);
  });

  it("pairs a modified line as one row: remove on the base cell, add on the head cell", () => {
    const rows = buildAlignedDiff("a\nb\nc\n", "a\nB\nc\n");
    expect(rows).toEqual([
      {
        baseLine: 1,
        baseText: "a",
        baseType: "context",
        headLine: 1,
        headText: "a",
        headType: "context",
      },
      {
        baseLine: 2,
        baseText: "b",
        baseType: "remove",
        headLine: 2,
        headText: "B",
        headType: "add",
      },
      {
        baseLine: 3,
        baseText: "c",
        baseType: "context",
        headLine: 3,
        headText: "c",
        headType: "context",
      },
    ]);
  });

  it("renders a pure addition with a blank base cell", () => {
    const rows = buildAlignedDiff("a\nc\n", "a\nb\nc\n");
    expect(rows).toEqual([
      {
        baseLine: 1,
        baseText: "a",
        baseType: "context",
        headLine: 1,
        headText: "a",
        headType: "context",
      },
      {
        baseLine: null,
        baseText: null,
        baseType: null,
        headLine: 2,
        headText: "b",
        headType: "add",
      },
      {
        baseLine: 2,
        baseText: "c",
        baseType: "context",
        headLine: 3,
        headText: "c",
        headType: "context",
      },
    ]);
  });

  it("renders a pure removal with a blank head cell", () => {
    const rows = buildAlignedDiff("a\nb\nc\n", "a\nc\n");
    expect(rows).toEqual([
      {
        baseLine: 1,
        baseText: "a",
        baseType: "context",
        headLine: 1,
        headText: "a",
        headType: "context",
      },
      {
        baseLine: 2,
        baseText: "b",
        baseType: "remove",
        headLine: null,
        headText: null,
        headType: null,
      },
      {
        baseLine: 3,
        baseText: "c",
        baseType: "context",
        headLine: 2,
        headText: "c",
        headType: "context",
      },
    ]);
  });

  it("keeps line numbers correct after an earlier change shifts the offset between sides", () => {
    const rows = buildAlignedDiff("a\nb\nc\nd\n", "a\nX\nY\nc\nd\n");
    const lastRow = rows.at(-1);
    expect(lastRow).toEqual({
      baseLine: 4,
      baseText: "d",
      baseType: "context",
      headLine: 5,
      headText: "d",
      headType: "context",
    });
  });

  it("handles an unbalanced multi-line change (more removed than added)", () => {
    const rows = buildAlignedDiff("a\nb\nc\nd\n", "a\nX\nd\n");
    expect(rows.slice(1, 4)).toEqual([
      {
        baseLine: 2,
        baseText: "b",
        baseType: "remove",
        headLine: 2,
        headText: "X",
        headType: "add",
      },
      {
        baseLine: 3,
        baseText: "c",
        baseType: "remove",
        headLine: null,
        headText: null,
        headType: null,
      },
      {
        baseLine: 4,
        baseText: "d",
        baseType: "context",
        headLine: 3,
        headText: "d",
        headType: "context",
      },
    ]);
  });
});
