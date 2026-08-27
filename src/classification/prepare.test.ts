import { describe, expect, it } from "vitest";
import type { ParsedDiff } from "../diff/change.js";
import { prepareClassifiableChanges } from "./prepare.js";

describe("prepareClassifiableChanges", () => {
  it("flattens every file's changes, carrying the file's status and a built excerpt", () => {
    const diff: ParsedDiff = {
      files: [
        {
          path: "src/a.ts",
          status: "modified",
          binary: false,
          changes: [
            {
              id: "src/a.ts:head:1-1",
              path: "src/a.ts",
              side: "head",
              range: { start: 1, end: 1 },
              lines: ["+new line"],
            },
          ],
        },
        {
          path: "src/b.ts",
          status: "added",
          binary: false,
          changes: [
            {
              id: "src/b.ts:head:1-2",
              path: "src/b.ts",
              side: "head",
              range: { start: 1, end: 2 },
              lines: ["+line1", "+line2"],
            },
          ],
        },
      ],
    };

    const result = prepareClassifiableChanges(diff);

    expect(result).toEqual([
      {
        id: "src/a.ts:head:1-1",
        path: "src/a.ts",
        status: "modified",
        side: "head",
        range: { start: 1, end: 1 },
        excerpt: "+new line",
      },
      {
        id: "src/b.ts:head:1-2",
        path: "src/b.ts",
        status: "added",
        side: "head",
        range: { start: 1, end: 2 },
        excerpt: "+line1\n+line2",
      },
    ]);
  });

  it("produces no changes for binary files (nothing to classify)", () => {
    const diff: ParsedDiff = {
      files: [{ path: "assets/logo.png", status: "modified", binary: true, changes: [] }],
    };

    expect(prepareClassifiableChanges(diff)).toEqual([]);
  });
});
