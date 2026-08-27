import { describe, expect, it } from "vitest";
import { parseDiff } from "./parse-diff.js";

describe("parseDiff", () => {
  it("parses an added file as a single head-side change", () => {
    const diff = [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "index 0000000..1234567",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,3 @@",
      "+export function hello() {",
      '+  return "hi";',
      "+}",
    ].join("\n");

    expect(parseDiff(diff)).toEqual({
      files: [
        {
          path: "src/new.ts",
          status: "added",
          binary: false,
          changes: [
            {
              id: "src/new.ts:head:1-3",
              path: "src/new.ts",
              side: "head",
              range: { start: 1, end: 3 },
              lines: ["+export function hello() {", '+  return "hi";', "+}"],
            },
          ],
        },
      ],
    });
  });

  it("parses a removed file as a single base-side change", () => {
    const diff = [
      "diff --git a/src/old.ts b/src/old.ts",
      "deleted file mode 100644",
      "index 1234567..0000000",
      "--- a/src/old.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-export const x = 1;",
      "-export const y = 2;",
    ].join("\n");

    expect(parseDiff(diff)).toEqual({
      files: [
        {
          path: "src/old.ts",
          status: "removed",
          binary: false,
          changes: [
            {
              id: "src/old.ts:base:1-2",
              path: "src/old.ts",
              side: "base",
              range: { start: 1, end: 2 },
              lines: ["-export const x = 1;", "-export const y = 2;"],
            },
          ],
        },
      ],
    });
  });

  it("parses a modified file with multiple hunks into separate changes", () => {
    const diff = [
      "diff --git a/src/mod.ts b/src/mod.ts",
      "index 1111111..2222222 100644",
      "--- a/src/mod.ts",
      "+++ b/src/mod.ts",
      "@@ -1,4 +1,4 @@",
      " line1",
      "-line2",
      "+line2 changed",
      " line3",
      " line4",
      "@@ -10,3 +10,4 @@",
      " line10",
      " line11",
      "+line12 new",
      " line13",
    ].join("\n");

    expect(parseDiff(diff)).toEqual({
      files: [
        {
          path: "src/mod.ts",
          status: "modified",
          binary: false,
          changes: [
            {
              id: "src/mod.ts:base:2-2",
              path: "src/mod.ts",
              side: "base",
              range: { start: 2, end: 2 },
              lines: ["-line2"],
            },
            {
              id: "src/mod.ts:head:2-2",
              path: "src/mod.ts",
              side: "head",
              range: { start: 2, end: 2 },
              lines: ["+line2 changed"],
            },
            {
              id: "src/mod.ts:head:12-12",
              path: "src/mod.ts",
              side: "head",
              range: { start: 12, end: 12 },
              lines: ["+line12 new"],
            },
          ],
        },
      ],
    });
  });

  it("parses a pure rename (no content change) with no changes", () => {
    const diff = [
      "diff --git a/src/old-name.ts b/src/new-name.ts",
      "similarity index 100%",
      "rename from src/old-name.ts",
      "rename to src/new-name.ts",
    ].join("\n");

    expect(parseDiff(diff)).toEqual({
      files: [
        {
          path: "src/new-name.ts",
          previousPath: "src/old-name.ts",
          status: "renamed",
          binary: false,
          changes: [],
        },
      ],
    });
  });

  it("parses a rename with content changes", () => {
    const diff = [
      "diff --git a/src/renamed-old.ts b/src/renamed-new.ts",
      "similarity index 90%",
      "rename from src/renamed-old.ts",
      "rename to src/renamed-new.ts",
      "index 1111111..2222222 100644",
      "--- a/src/renamed-old.ts",
      "+++ b/src/renamed-new.ts",
      "@@ -1,2 +1,2 @@",
      " unchanged",
      "-old content",
      "+new content",
    ].join("\n");

    expect(parseDiff(diff)).toEqual({
      files: [
        {
          path: "src/renamed-new.ts",
          previousPath: "src/renamed-old.ts",
          status: "renamed",
          binary: false,
          changes: [
            {
              id: "src/renamed-new.ts:base:2-2",
              path: "src/renamed-new.ts",
              side: "base",
              range: { start: 2, end: 2 },
              lines: ["-old content"],
            },
            {
              id: "src/renamed-new.ts:head:2-2",
              path: "src/renamed-new.ts",
              side: "head",
              range: { start: 2, end: 2 },
              lines: ["+new content"],
            },
          ],
        },
      ],
    });
  });

  it("parses a modified binary file with no line-level changes", () => {
    const diff = [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "index 1111111..2222222 100644",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
    ].join("\n");

    expect(parseDiff(diff)).toEqual({
      files: [{ path: "assets/logo.png", status: "modified", binary: true, changes: [] }],
    });
  });

  it("parses an added binary file", () => {
    const diff = [
      "diff --git a/assets/new.png b/assets/new.png",
      "new file mode 100644",
      "index 0000000..2222222",
      "Binary files /dev/null and b/assets/new.png differ",
    ].join("\n");

    expect(parseDiff(diff)).toEqual({
      files: [{ path: "assets/new.png", status: "added", binary: true, changes: [] }],
    });
  });

  it("resolves a mode-only diff's path even when it contains ' b/'", () => {
    // No ---/+++ or rename lines here, so the header split is the only source of the path.
    const diff = ["diff --git a/x b/y.txt b/x b/y.txt", "old mode 100644", "new mode 100755"].join(
      "\n",
    );

    expect(parseDiff(diff)).toEqual({
      files: [{ path: "x b/y.txt", status: "modified", binary: false, changes: [] }],
    });
  });

  it("parses multiple files in one diff, preserving order", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "new file mode 100644",
      "index 0000000..1234567",
      "--- /dev/null",
      "+++ b/a.ts",
      "@@ -0,0 +1,1 @@",
      "+a",
      "diff --git a/b.ts b/b.ts",
      "deleted file mode 100644",
      "index 1234567..0000000",
      "--- a/b.ts",
      "+++ /dev/null",
      "@@ -1,1 +0,0 @@",
      "-b",
    ].join("\n");

    const result = parseDiff(diff);
    expect(result.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });
});
