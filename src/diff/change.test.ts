import { describe, expect, it } from "vitest";
import { type ChangeSideContent, changeDiffLines, changeId, makeChange } from "./change.js";

const base: ChangeSideContent = { range: { start: 2, end: 3 }, lines: ["-a", "-b"] };
const head: ChangeSideContent = { range: { start: 2, end: 4 }, lines: ["+x", "+y", "+z"] };

describe("changeDiffLines", () => {
  it("returns base lines then head lines, keeping markers", () => {
    expect(changeDiffLines({ base, head })).toEqual(["-a", "-b", "+x", "+y", "+z"]);
  });

  it("returns just the present side for a single-sided change", () => {
    expect(changeDiffLines({ head })).toEqual(["+x", "+y", "+z"]);
    expect(changeDiffLines({ base })).toEqual(["-a", "-b"]);
  });
});

describe("changeId", () => {
  it("uses the head range for an addition and the base range for a deletion", () => {
    expect(changeId("src/f.ts", { head })).toBe("src/f.ts:head:2-4");
    expect(changeId("src/f.ts", { base })).toBe("src/f.ts:base:2-3");
  });

  it("uses a distinct mod namespace carrying both ranges for a modification", () => {
    expect(changeId("src/f.ts", { base, head })).toBe("src/f.ts:mod:2-3:2-4");
  });

  it("throws when no side is present", () => {
    expect(() => changeId("src/f.ts", {})).toThrow();
  });
});

describe("makeChange", () => {
  it("assigns the id and keeps only the present sides", () => {
    expect(makeChange("src/f.ts", { base, head })).toEqual({
      id: "src/f.ts:mod:2-3:2-4",
      path: "src/f.ts",
      base,
      head,
    });
    expect(makeChange("src/f.ts", { head })).toEqual({
      id: "src/f.ts:head:2-4",
      path: "src/f.ts",
      head,
    });
  });

  it("throws when neither base nor head is given", () => {
    expect(() => makeChange("src/f.ts", {})).toThrow();
  });
});
