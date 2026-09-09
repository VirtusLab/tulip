import { describe, expect, it } from "vitest";
import { config } from "../config.js";
import type { Change } from "../diff/change.js";
import { buildExcerpt, isExcerptTruncated } from "./excerpt.js";

const MAX_EXCERPT_CHARS = config.limits.maxExcerptChars;

function makeChange(lines: string[]): Change {
  return {
    id: "src/x.ts:head:1-1",
    path: "src/x.ts",
    head: { range: { start: 1, end: lines.length }, lines },
  };
}

describe("buildExcerpt", () => {
  it("joins the change's lines, +/- markers included, with newlines", () => {
    const excerpt = buildExcerpt(makeChange(["+a", "+b", "-c"]));
    expect(excerpt).toBe("+a\n+b\n-c");
  });

  it("returns short excerpts unchanged", () => {
    const excerpt = buildExcerpt(makeChange(["+short"]));
    expect(excerpt).toBe("+short");
  });

  it("truncates excerpts longer than MAX_EXCERPT_CHARS, with a marker", () => {
    const longLine = `+${"x".repeat(MAX_EXCERPT_CHARS)}`;
    const excerpt = buildExcerpt(makeChange([longLine]));

    expect(excerpt.length).toBeLessThan(longLine.length);
    expect(excerpt).toMatch(/truncated/);
  });
});

describe("isExcerptTruncated", () => {
  it("is true for an excerpt buildExcerpt truncated", () => {
    const longLine = `+${"x".repeat(MAX_EXCERPT_CHARS)}`;
    const excerpt = buildExcerpt(makeChange([longLine]));

    expect(isExcerptTruncated(excerpt)).toBe(true);
  });

  it("is false for an excerpt buildExcerpt left untouched", () => {
    const excerpt = buildExcerpt(makeChange(["+short"]));

    expect(isExcerptTruncated(excerpt)).toBe(false);
  });
});
