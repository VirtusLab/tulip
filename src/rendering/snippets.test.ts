import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";
import type { SnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { type AlignedRow, buildAlignedDiff } from "./line-diff.js";
import { renderSnippetBlock, renderSnippetRow, type SnippetPaneMode } from "./snippets.js";

function ref(overrides: Partial<SnippetRef> = {}): SnippetRef {
  return {
    path: "src/a.ts",
    side: "head",
    lines: { start: 2, end: 2 },
    unfold: true,
    ...overrides,
  };
}

function fileDiffs(
  rows: FileDiffData["rows"],
  embeddable = true,
  status?: FileDiffData["status"],
): Map<string, FileDiffData> {
  return new Map([["src/a.ts", { rows, embeddable, ...(status ? { status } : {}) }]]);
}

describe("renderSnippetBlock", () => {
  it("renders the referenced range as side-by-side rows", () => {
    const rows = buildAlignedDiff("a\nb\nc\n", "a\nB\nc\n");
    const html = renderSnippetBlock(ref({ lines: { start: 2, end: 2 } }), fileDiffs(rows));
    const root = parse(html);
    const trs = root.querySelectorAll("tr");
    expect(trs).toHaveLength(1);
    expect(trs[0]?.querySelector(".snippet-cell-base code")?.text).toBe("b");
    expect(trs[0]?.querySelector(".snippet-cell-head code")?.text).toBe("B");
    expect(trs[0]?.querySelector(".snippet-cell-base")?.classList.contains("type-remove")).toBe(
      true,
    );
    expect(trs[0]?.querySelector(".snippet-cell-head")?.classList.contains("type-add")).toBe(true);
  });

  it("renders every row in a multi-line range", () => {
    const rows = buildAlignedDiff("a\nb\nc\nd\n", "a\nb\nc\nd\n");
    const html = renderSnippetBlock(
      ref({ side: "head", lines: { start: 1, end: 3 } }),
      fileDiffs(rows),
    );
    const root = parse(html);
    expect(root.querySelectorAll("tr")).toHaveLength(3);
  });

  it("is open by default when unfold is true", () => {
    const rows = buildAlignedDiff("a\n", "a\n");
    const html = renderSnippetBlock(
      ref({ unfold: true, lines: { start: 1, end: 1 } }),
      fileDiffs(rows),
    );
    expect(parse(html).querySelector("details")?.hasAttribute("open")).toBe(true);
  });

  it("is collapsed by default when unfold is false", () => {
    const rows = buildAlignedDiff("a\n", "a\n");
    const html = renderSnippetBlock(
      ref({ unfold: false, lines: { start: 1, end: 1 } }),
      fileDiffs(rows),
    );
    const details = parse(html).querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.text).toContain("1 line");
  });

  it("renders an explicit +/- gutter marker alongside the existing color, blank for context rows", () => {
    const rows = buildAlignedDiff("a\nb\nc\n", "a\nB\nc\n");
    const html = renderSnippetBlock(ref({ lines: { start: 1, end: 2 } }), fileDiffs(rows));
    const root = parse(html);
    const trs = root.querySelectorAll("tr");
    // Row 0 ("a") is unchanged context — blank markers both sides.
    expect(trs[0]?.querySelectorAll(".snippet-marker").map((td) => td.text)).toEqual(["", ""]);
    // Row 1 ("b" -> "B") is a remove/add pair — "-" on the base side, "+" on the head side.
    expect(trs[1]?.querySelector(".snippet-marker.side-base")?.text).toBe("-");
    expect(trs[1]?.querySelector(".snippet-marker.side-head")?.text).toBe("+");
  });

  it("forces the details closed when forceCollapsed is set, even with unfold=yes", () => {
    const rows = buildAlignedDiff("a\n", "a\n");
    const html = renderSnippetBlock(
      ref({ unfold: true, lines: { start: 1, end: 1 } }),
      fileDiffs(rows),
      true,
    );
    expect(parse(html).querySelector("details")?.hasAttribute("open")).toBe(false);
  });

  it("still honors unfold=yes when forceCollapsed is false (the default)", () => {
    const rows = buildAlignedDiff("a\n", "a\n");
    const html = renderSnippetBlock(
      ref({ unfold: true, lines: { start: 1, end: 1 } }),
      fileDiffs(rows),
    );
    expect(parse(html).querySelector("details")?.hasAttribute("open")).toBe(true);
  });

  it("wraps long lines for a prose/doc file instead of scrolling", () => {
    const rows = buildAlignedDiff("a\n", "a\n");
    const proseFileDiffs = new Map([["docs/readme.md", { rows, embeddable: true }]]);
    const html = renderSnippetBlock(
      ref({ path: "docs/readme.md", lines: { start: 1, end: 1 } }),
      proseFileDiffs,
    );
    const scrollDiv = parse(html).querySelector(".snippet-scroll");
    expect(scrollDiv?.classList.contains("snippet-wrap")).toBe(true);
  });

  it("keeps the scrolling (no-wrap) behavior for a code file", () => {
    const rows = buildAlignedDiff("a\n", "a\n");
    const html = renderSnippetBlock(
      ref({ path: "src/a.ts", lines: { start: 1, end: 1 } }),
      fileDiffs(rows),
    );
    const scrollDiv = parse(html).querySelector(".snippet-scroll");
    expect(scrollDiv?.classList.contains("snippet-wrap")).toBe(false);
  });

  it("shows expand buttons only when the file is embeddable and more context exists", () => {
    const rows = buildAlignedDiff("a\nb\nc\n", "a\nb\nc\n");
    const embeddableHtml = renderSnippetBlock(
      ref({ lines: { start: 2, end: 2 } }),
      fileDiffs(rows, true),
    );
    expect(parse(embeddableHtml).querySelectorAll(".snippet-expand")).toHaveLength(2);

    const cappedHtml = renderSnippetBlock(
      ref({ lines: { start: 2, end: 2 } }),
      fileDiffs(rows, false),
    );
    expect(parse(cappedHtml).querySelectorAll(".snippet-expand")).toHaveLength(0);
  });

  it("omits the expand-up button at the top of the file and expand-down at the bottom", () => {
    const rows = buildAlignedDiff("a\nb\nc\n", "a\nb\nc\n");
    const top = renderSnippetBlock(ref({ lines: { start: 1, end: 1 } }), fileDiffs(rows, true));
    expect(parse(top).querySelectorAll('.snippet-expand[data-dir="up"]')).toHaveLength(0);
    expect(parse(top).querySelectorAll('.snippet-expand[data-dir="down"]')).toHaveLength(1);

    const bottom = renderSnippetBlock(ref({ lines: { start: 3, end: 3 } }), fileDiffs(rows, true));
    expect(parse(bottom).querySelectorAll('.snippet-expand[data-dir="up"]')).toHaveLength(1);
    expect(parse(bottom).querySelectorAll('.snippet-expand[data-dir="down"]')).toHaveLength(0);
  });

  it("records the path and row-index window as data attributes", () => {
    const rows = buildAlignedDiff("a\nb\nc\n", "a\nb\nc\n");
    const html = renderSnippetBlock(ref({ lines: { start: 2, end: 2 } }), fileDiffs(rows, true));
    const container = parse(html).querySelector(".snippet");
    expect(container?.getAttribute("data-path")).toBe("src/a.ts");
    expect(container?.getAttribute("data-start-index")).toBe("1");
    expect(container?.getAttribute("data-end-index")).toBe("1");
  });

  it("records the file's guessed highlight.js language as a data attribute", () => {
    const rows = buildAlignedDiff("a\n", "a\n");
    const html = renderSnippetBlock(
      ref({ path: "src/a.ts", lines: { start: 1, end: 1 } }),
      fileDiffs(rows),
    );
    expect(parse(html).querySelector(".snippet")?.getAttribute("data-lang")).toBe("typescript");
  });

  it("omits the language data attribute for an unrecognized extension", () => {
    const rows = buildAlignedDiff("a\n", "a\n");
    const html = renderSnippetBlock(
      ref({ path: "src/a.xyz123", lines: { start: 1, end: 1 } }),
      fileDiffs(rows),
    );
    expect(parse(html).querySelector(".snippet")?.hasAttribute("data-lang")).toBe(false);
  });

  it("wraps the diff table in a horizontally-scrollable container", () => {
    const rows = buildAlignedDiff("a\n", "a\n");
    const html = renderSnippetBlock(ref({ lines: { start: 1, end: 1 } }), fileDiffs(rows));
    expect(parse(html).querySelector(".snippet-scroll > .snippet-table")).not.toBeNull();
  });

  it("falls back gracefully when the file has no diff data", () => {
    const html = renderSnippetBlock(ref(), new Map());
    expect(html).toContain("could not be loaded");
    expect(html).toContain("src/a.ts");
  });

  it("falls back gracefully when the referenced range isn't found in the diff", () => {
    const rows = buildAlignedDiff("a\n", "a\n");
    const html = renderSnippetBlock(ref({ lines: { start: 99, end: 99 } }), fileDiffs(rows));
    expect(html).toContain("could not be located");
  });

  it("escapes untrusted file content", () => {
    const rows = buildAlignedDiff("<script>x</script>\n", "<script>x</script>\n");
    const html = renderSnippetBlock(ref({ lines: { start: 1, end: 1 } }), fileDiffs(rows));
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// task: a new/deleted file shouldn't render a two-pane split with one side always blank (see
// ./file-diffs.ts's `FileDiffData.status` and `paneModeForStatus`).
describe("renderSnippetBlock — pane mode by file status", () => {
  it("renders an added file as a single head-only pane, all '+'", () => {
    const rows = buildAlignedDiff("", "line1\nline2\n");
    const html = renderSnippetBlock(
      ref({ side: "head", lines: { start: 1, end: 2 } }),
      fileDiffs(rows, true, "added"),
    );
    const root = parse(html);
    expect(root.querySelector(".snippet")?.getAttribute("data-pane-mode")).toBe("head-only");
    const trs = root.querySelectorAll("tr");
    expect(trs).toHaveLength(2);
    for (const tr of trs) {
      // Only the head side's 3 cells — no base-side cells at all, not even blank ones.
      expect(tr.querySelectorAll("td")).toHaveLength(3);
      expect(tr.querySelector(".snippet-cell-base")).toBeNull();
      expect(tr.querySelector(".snippet-marker")?.text).toBe("+");
    }
  });

  it("renders a deleted file as a single base-only pane, all '-'", () => {
    const rows = buildAlignedDiff("line1\nline2\n", "");
    const html = renderSnippetBlock(
      ref({ side: "base", lines: { start: 1, end: 2 } }),
      fileDiffs(rows, true, "removed"),
    );
    const root = parse(html);
    expect(root.querySelector(".snippet")?.getAttribute("data-pane-mode")).toBe("base-only");
    const trs = root.querySelectorAll("tr");
    expect(trs).toHaveLength(2);
    for (const tr of trs) {
      // Only the base side's 3 cells — no head-side cells at all, not even blank ones.
      expect(tr.querySelectorAll("td")).toHaveLength(3);
      expect(tr.querySelector(".snippet-cell-head")).toBeNull();
      expect(tr.querySelector(".snippet-marker")?.text).toBe("-");
    }
  });

  it("keeps the two-pane split for a modified file", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const html = renderSnippetBlock(
      ref({ lines: { start: 1, end: 1 } }),
      fileDiffs(rows, true, "modified"),
    );
    const root = parse(html);
    expect(root.querySelector(".snippet")?.getAttribute("data-pane-mode")).toBe("split");
    expect(root.querySelector("tr")?.querySelectorAll("td")).toHaveLength(6);
  });

  it("keeps the two-pane split for a renamed-with-changes file", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const html = renderSnippetBlock(
      ref({ lines: { start: 1, end: 1 } }),
      fileDiffs(rows, true, "renamed"),
    );
    const root = parse(html);
    expect(root.querySelector(".snippet")?.getAttribute("data-pane-mode")).toBe("split");
    expect(root.querySelector("tr")?.querySelectorAll("td")).toHaveLength(6);
  });

  it("defaults to the two-pane split when the status is unknown (pre-existing behavior)", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const html = renderSnippetBlock(ref({ lines: { start: 1, end: 1 } }), fileDiffs(rows));
    expect(parse(html).querySelector(".snippet")?.getAttribute("data-pane-mode")).toBe("split");
  });
});

// ./assets/app.js's `renderSnippetRow` is a hand-maintained mirror of `renderSnippetRow`
// exported from this module (used client-side to insert context rows without a server
// round-trip — see setupSnippetExpansion in app.js). Nothing in the type system enforces the
// two stay identical, so this loads app.js's actual source, evaluates just its row-rendering
// block in Node (no browser/DOM needed — `escapeHtml`/`cellTypeClass`/`renderSnippetRow` don't
// touch `document`/`window`), and asserts both implementations produce the same HTML for the
// same input.
function loadClientRenderSnippetRow(): (row: AlignedRow, paneMode?: SnippetPaneMode) => string {
  const appJsPath = fileURLToPath(new URL("./assets/app.js", import.meta.url));
  const source = readFileSync(appJsPath, "utf8");

  const start = source.indexOf("var SNIPPET_ESCAPES");
  const end = source.indexOf("function loadFileData");
  if (start === -1 || end === -1) {
    throw new Error(
      "could not locate the row-rendering block in assets/app.js — parity test needs updating",
    );
  }

  const factory = new Function(`${source.slice(start, end)}\nreturn renderSnippetRow;`);
  return factory() as (row: AlignedRow, paneMode?: SnippetPaneMode) => string;
}

describe("renderSnippetRow / assets/app.js parity", () => {
  it("renders byte-identical HTML to assets/app.js's client-side row renderer", () => {
    const clientRenderSnippetRow = loadClientRenderSnippetRow();
    const rows: AlignedRow[] = [
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
        baseText: "removed line",
        baseType: "remove",
        headLine: null,
        headText: null,
        headType: null,
      },
      {
        baseLine: null,
        baseText: null,
        baseType: null,
        headLine: 2,
        headText: "added line",
        headType: "add",
      },
      {
        baseLine: 3,
        baseText: `<script>&"'</script>`,
        baseType: "remove",
        headLine: 3,
        headText: "<img src=x onerror=1>",
        headType: "add",
      },
    ];

    const paneModes: SnippetPaneMode[] = ["split", "head-only", "base-only"];
    for (const row of rows) {
      for (const paneMode of paneModes) {
        expect(clientRenderSnippetRow(row, paneMode)).toBe(renderSnippetRow(row, paneMode));
      }
      // Default parameter (no explicit paneMode) must also match, on both sides.
      expect(clientRenderSnippetRow(row)).toBe(renderSnippetRow(row));
    }
  });
});
