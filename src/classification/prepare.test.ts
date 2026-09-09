import { describe, expect, it } from "vitest";
import type { ParsedDiff } from "../diff/change.js";
import { parseDiff } from "../diff/parse-diff.js";
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
              head: { range: { start: 1, end: 1 }, lines: ["+new line"] },
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
              head: { range: { start: 1, end: 2 }, lines: ["+line1", "+line2"] },
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
        head: { range: { start: 1, end: 1 }, lines: ["+new line"] },
        excerpt: "+new line",
      },
      {
        id: "src/b.ts:head:1-2",
        path: "src/b.ts",
        status: "added",
        head: { range: { start: 1, end: 2 }, lines: ["+line1", "+line2"] },
        excerpt: "+line1\n+line2",
      },
    ]);
  });

  it("maps an in-place modification to ONE classifiable change (no duplicate before/after)", () => {
    // The bug docs/adr/0018 fixes: a `-old`/`+new` edit used to split into two changes, each
    // rendered as the same before/after diff. It must now be a single classifiable change whose
    // excerpt/lines carry the combined diff.
    const diff = parseDiff(
      [
        "diff --git a/src/f.ts b/src/f.ts",
        "index 1111111..2222222 100644",
        "--- a/src/f.ts",
        "+++ b/src/f.ts",
        "@@ -1,1 +1,1 @@",
        "-old",
        "+new",
      ].join("\n"),
    );

    const result = prepareClassifiableChanges(diff);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("src/f.ts:mod:1-1:1-1");
    expect(result[0]?.base).toEqual({ range: { start: 1, end: 1 }, lines: ["-old"] });
    expect(result[0]?.head).toEqual({ range: { start: 1, end: 1 }, lines: ["+new"] });
    expect(result[0]?.excerpt).toBe("-old\n+new");
  });

  it("produces no changes for binary files (nothing to classify)", () => {
    const diff: ParsedDiff = {
      files: [{ path: "assets/logo.png", status: "modified", binary: true, changes: [] }],
    };

    expect(prepareClassifiableChanges(diff)).toEqual([]);
  });
});
