import { describe, expect, it } from "vitest";
import { changeLocationRanges } from "./types.js";

describe("changeLocationRanges", () => {
  it("lists both sides for a modification", () => {
    expect(
      changeLocationRanges({
        base: { range: { start: 2, end: 3 }, lines: [] },
        head: { range: { start: 5, end: 8 }, lines: [] },
      }),
    ).toBe("base 2-3, head 5-8");
  });
});
