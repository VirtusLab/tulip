import { describe, expect, it } from "vitest";
import type { Change } from "./change.js";
import { parseDiff } from "./parse-diff.js";

/** The single file's changes for a diff built from `body` hunk lines (modified file, one hunk). */
function changesOf(body: string[], header = "@@ -1,9 +1,9 @@"): Change[] {
  const diff = [
    "diff --git a/src/f.ts b/src/f.ts",
    "index 1111111..2222222 100644",
    "--- a/src/f.ts",
    "+++ b/src/f.ts",
    header,
    ...body,
  ].join("\n");
  return parseDiff(diff).files[0]?.changes ?? [];
}

describe("parseDiff — file shapes", () => {
  it("parses an added file as a single head-only addition spanning the file", () => {
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
              head: {
                range: { start: 1, end: 3 },
                lines: ["+export function hello() {", '+  return "hi";', "+}"],
              },
            },
          ],
        },
      ],
    });
  });

  it("parses a removed file as a single base-only deletion", () => {
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
              base: {
                range: { start: 1, end: 2 },
                lines: ["-export const x = 1;", "-export const y = 2;"],
              },
            },
          ],
        },
      ],
    });
  });

  it("pairs a removed line and its replacement into ONE modification, keeping later hunks separate", () => {
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
              id: "src/mod.ts:mod:2-2:2-2",
              path: "src/mod.ts",
              base: { range: { start: 2, end: 2 }, lines: ["-line2"] },
              head: { range: { start: 2, end: 2 }, lines: ["+line2 changed"] },
            },
            {
              id: "src/mod.ts:head:12-12",
              path: "src/mod.ts",
              head: { range: { start: 12, end: 12 }, lines: ["+line12 new"] },
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

  it("parses a rename with content changes, pairing the edited line into a modification", () => {
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
              id: "src/renamed-new.ts:mod:2-2:2-2",
              path: "src/renamed-new.ts",
              base: { range: { start: 2, end: 2 }, lines: ["-old content"] },
              head: { range: { start: 2, end: 2 }, lines: ["+new content"] },
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

describe("parseHunkBody — pairing rule (docs/adr/0018)", () => {
  it("pairs a single -/+ into one modification (base 1 / head 1)", () => {
    // Hunk starts at base/head line 5; context, then -old +new.
    expect(changesOf([" ctx", "-old", "+new"], "@@ -5,2 +5,2 @@")).toEqual([
      {
        id: "src/f.ts:mod:6-6:6-6",
        path: "src/f.ts",
        base: { range: { start: 6, end: 6 }, lines: ["-old"] },
        head: { range: { start: 6, end: 6 }, lines: ["+new"] },
      },
    ]);
  });

  it("counts base and head lines from their own divergent hunk starts", () => {
    // Header advances base from 5, head from 40 — guards a baseLine/headLine counter swap.
    expect(changesOf(["-old", "+new"], "@@ -5,2 +40,2 @@")).toEqual([
      {
        id: "src/f.ts:mod:5-5:40-40",
        path: "src/f.ts",
        base: { range: { start: 5, end: 5 }, lines: ["-old"] },
        head: { range: { start: 40, end: 40 }, lines: ["+new"] },
      },
    ]);
  });

  it("pairs a base-longer modification (-a -b -c +x) into one change", () => {
    expect(changesOf(["-a", "-b", "-c", "+x"])).toEqual([
      {
        id: "src/f.ts:mod:1-3:1-1",
        path: "src/f.ts",
        base: { range: { start: 1, end: 3 }, lines: ["-a", "-b", "-c"] },
        head: { range: { start: 1, end: 1 }, lines: ["+x"] },
      },
    ]);
  });

  it("pairs a head-longer modification (-a +x +y +z) into one change", () => {
    expect(changesOf(["-a", "+x", "+y", "+z"])).toEqual([
      {
        id: "src/f.ts:mod:1-1:1-3",
        path: "src/f.ts",
        base: { range: { start: 1, end: 1 }, lines: ["-a"] },
        head: { range: { start: 1, end: 3 }, lines: ["+x", "+y", "+z"] },
      },
    ]);
  });

  it("pairs an equal-length modification", () => {
    expect(changesOf(["-a", "-b", "+x", "+y"])).toEqual([
      {
        id: "src/f.ts:mod:1-2:1-2",
        path: "src/f.ts",
        base: { range: { start: 1, end: 2 }, lines: ["-a", "-b"] },
        head: { range: { start: 1, end: 2 }, lines: ["+x", "+y"] },
      },
    ]);
  });

  it("splits a deletion·context·addition into a separate deletion and addition", () => {
    const changes = changesOf(["-a", " ctx", "+b"]);
    expect(changes).toEqual([
      {
        id: "src/f.ts:base:1-1",
        path: "src/f.ts",
        base: { range: { start: 1, end: 1 }, lines: ["-a"] },
      },
      {
        id: "src/f.ts:head:2-2",
        path: "src/f.ts",
        head: { range: { start: 2, end: 2 }, lines: ["+b"] },
      },
    ]);
  });

  it("splits interleaved -a +b -c +d into two modifications", () => {
    const changes = changesOf(["-a", "+b", "-c", "+d"]);
    expect(changes).toEqual([
      {
        id: "src/f.ts:mod:1-1:1-1",
        path: "src/f.ts",
        base: { range: { start: 1, end: 1 }, lines: ["-a"] },
        head: { range: { start: 1, end: 1 }, lines: ["+b"] },
      },
      {
        id: "src/f.ts:mod:2-2:2-2",
        path: "src/f.ts",
        base: { range: { start: 2, end: 2 }, lines: ["-c"] },
        head: { range: { start: 2, end: 2 }, lines: ["+d"] },
      },
    ]);
  });

  it("keeps add-before-delete as an addition then a deletion", () => {
    const changes = changesOf(["+a", "-b"]);
    expect(changes).toEqual([
      {
        id: "src/f.ts:head:1-1",
        path: "src/f.ts",
        head: { range: { start: 1, end: 1 }, lines: ["+a"] },
      },
      {
        id: "src/f.ts:base:1-1",
        path: "src/f.ts",
        base: { range: { start: 1, end: 1 }, lines: ["-b"] },
      },
    ]);
  });

  it("parses an addition-only hunk inside a modified file as a head-only addition", () => {
    expect(changesOf([" ctx", "+a", "+b", " ctx2"], "@@ -1,3 +1,4 @@")).toEqual([
      {
        id: "src/f.ts:head:2-3",
        path: "src/f.ts",
        head: { range: { start: 2, end: 3 }, lines: ["+a", "+b"] },
      },
    ]);
  });
});
