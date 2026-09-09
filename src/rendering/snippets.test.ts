import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";
import type { SnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { type AlignedRow, buildAlignedDiff } from "./line-diff.js";
import { renderSnippetBlock, renderSnippetRow, type SnippetPaneMode } from "./snippets.js";

function fileDiffs(
  rows: FileDiffData["rows"],
  embeddable = true,
  path = "src/a.ts",
): Map<string, FileDiffData> {
  return new Map([[path, { rows, embeddable }]]);
}

describe("renderSnippetBlock — per-region alignment", () => {
  it("renders a modification (both sides) as one paired before/after row", () => {
    const rows = buildAlignedDiff("a\nb\nc\n", "a\nB\nc\n");
    const ref: SnippetRef = {
      path: "src/a.ts",
      base: { start: 2, end: 2 },
      head: { start: 2, end: 2 },
      unfold: true,
    };
    const root = parse(renderSnippetBlock(ref, fileDiffs(rows)));
    const trs = root.querySelectorAll("tr");
    expect(trs).toHaveLength(1);
    expect(trs[0]?.querySelector(".snippet-cell-base code")?.text).toBe("b");
    expect(trs[0]?.querySelector(".snippet-cell-head code")?.text).toBe("B");
    expect(trs[0]?.querySelector(".snippet-cell-base")?.classList.contains("type-remove")).toBe(
      true,
    );
    expect(trs[0]?.querySelector(".snippet-cell-head")?.classList.contains("type-add")).toBe(true);
    expect(root.querySelector(".snippet")?.getAttribute("data-pane-mode")).toBe("split");
  });

  it("renders every row of a base-longer modification, both panes, no rows dropped", () => {
    // base a,b,c -> head x: 3 removed / 1 added.
    const rows = buildAlignedDiff("a\nb\nc\n", "x\n");
    const ref: SnippetRef = {
      path: "src/a.ts",
      base: { start: 1, end: 3 },
      head: { start: 1, end: 1 },
      unfold: true,
    };
    const trs = parse(renderSnippetBlock(ref, fileDiffs(rows))).querySelectorAll("tr");
    expect(trs).toHaveLength(3); // max(3 base, 1 head)
    expect(trs.map((tr) => tr.querySelector(".snippet-cell-base code")?.text)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(trs[0]?.querySelector(".snippet-cell-head code")?.text).toBe("x");
  });

  it("renders every row of a head-longer modification, both panes, no rows dropped", () => {
    const rows = buildAlignedDiff("a\n", "x\ny\nz\n");
    const ref: SnippetRef = {
      path: "src/a.ts",
      base: { start: 1, end: 1 },
      head: { start: 1, end: 3 },
      unfold: true,
    };
    const trs = parse(renderSnippetBlock(ref, fileDiffs(rows))).querySelectorAll("tr");
    expect(trs).toHaveLength(3);
    expect(trs.map((tr) => tr.querySelector(".snippet-cell-head code")?.text)).toEqual([
      "x",
      "y",
      "z",
    ]);
  });

  it("shows real file line numbers, not 1-based region numbers, for a snippet past line 1", () => {
    // A change deep in the file: line 40 modified. The rendered line-number cells must carry the
    // real file line (40), guarding a regression where a split piece at line 40 renders as line 1.
    const base = Array.from({ length: 41 }, (_, i) => (i === 39 ? "old" : `line${i + 1}`)).join(
      "\n",
    );
    const head = Array.from({ length: 41 }, (_, i) => (i === 39 ? "new" : `line${i + 1}`)).join(
      "\n",
    );
    const rows = buildAlignedDiff(`${base}\n`, `${head}\n`);
    const ref: SnippetRef = {
      path: "src/a.ts",
      base: { start: 40, end: 40 },
      head: { start: 40, end: 40 },
      unfold: true,
    };
    const trs = parse(renderSnippetBlock(ref, fileDiffs(rows))).querySelectorAll("tr");
    expect(trs).toHaveLength(1);
    expect(trs[0]?.querySelector(".snippet-line-no.side-base")?.text).toBe("40");
    expect(trs[0]?.querySelector(".snippet-line-no.side-head")?.text).toBe("40");
  });

  it("renders an addition ref as a head-only single pane", () => {
    const rows = buildAlignedDiff("", "line1\nline2\n");
    const ref: SnippetRef = { path: "src/a.ts", head: { start: 1, end: 2 }, unfold: true };
    const root = parse(renderSnippetBlock(ref, fileDiffs(rows)));
    expect(root.querySelector(".snippet")?.getAttribute("data-pane-mode")).toBe("head-only");
    const trs = root.querySelectorAll("tr");
    expect(trs).toHaveLength(2);
    for (const tr of trs) {
      expect(tr.querySelectorAll("td")).toHaveLength(3);
      expect(tr.querySelector(".snippet-cell-base")).toBeNull();
      expect(tr.querySelector(".snippet-marker")?.text).toBe("+");
    }
  });

  it("renders a deletion ref as a base-only single pane", () => {
    const rows = buildAlignedDiff("line1\nline2\n", "");
    const ref: SnippetRef = { path: "src/a.ts", base: { start: 1, end: 2 }, unfold: true };
    const root = parse(renderSnippetBlock(ref, fileDiffs(rows)));
    expect(root.querySelector(".snippet")?.getAttribute("data-pane-mode")).toBe("base-only");
    const trs = root.querySelectorAll("tr");
    expect(trs).toHaveLength(2);
    for (const tr of trs) {
      expect(tr.querySelectorAll("td")).toHaveLength(3);
      expect(tr.querySelector(".snippet-cell-head")).toBeNull();
      expect(tr.querySelector(".snippet-marker")?.text).toBe("-");
    }
  });

  it("renders a pure add inside a two-sided file as a single head-only pane (pane follows the ref)", () => {
    // A modified file (both sides have content), but the ref is a head-only addition.
    const rows = buildAlignedDiff("a\nc\n", "a\nb\nc\n");
    const ref: SnippetRef = { path: "src/a.ts", head: { start: 2, end: 2 }, unfold: true };
    const root = parse(renderSnippetBlock(ref, fileDiffs(rows)));
    expect(root.querySelector(".snippet")?.getAttribute("data-pane-mode")).toBe("head-only");
    expect(root.querySelector("tr")?.querySelectorAll("td")).toHaveLength(3);
  });

  it("renders two adjacent split sub-modifications as disjoint, non-overlapping rows", () => {
    // Lines 2 and 3 both modified; split into piece A (line 2) and piece B (line 3).
    const rows = buildAlignedDiff("a\nb\nc\nd\n", "a\nB\nC\nd\n");
    const pieceA: SnippetRef = {
      path: "src/a.ts",
      base: { start: 2, end: 2 },
      head: { start: 2, end: 2 },
      unfold: true,
    };
    const pieceB: SnippetRef = {
      path: "src/a.ts",
      base: { start: 3, end: 3 },
      head: { start: 3, end: 3 },
      unfold: true,
    };
    const rowsA = parse(renderSnippetBlock(pieceA, fileDiffs(rows))).querySelectorAll("tr");
    const rowsB = parse(renderSnippetBlock(pieceB, fileDiffs(rows))).querySelectorAll("tr");
    expect(rowsA.map((tr) => tr.querySelector(".snippet-cell-base code")?.text)).toEqual(["b"]);
    expect(rowsB.map((tr) => tr.querySelector(".snippet-cell-base code")?.text)).toEqual(["c"]);
  });
});

describe("renderSnippetBlock — fold/unfold and wrapping", () => {
  const modRef = (unfold: boolean): SnippetRef => ({
    path: "src/a.ts",
    base: { start: 1, end: 1 },
    head: { start: 1, end: 1 },
    unfold,
  });

  it("is open by default when unfold is true", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    expect(
      parse(renderSnippetBlock(modRef(true), fileDiffs(rows)))
        .querySelector("details")
        ?.hasAttribute("open"),
    ).toBe(true);
  });

  it("is collapsed by default when unfold is false, showing a line count", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const details = parse(renderSnippetBlock(modRef(false), fileDiffs(rows))).querySelector(
      "details",
    );
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.text).toContain("1 line");
  });

  it("forces the details closed when forceCollapsed is set, even with unfold=yes", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    expect(
      parse(renderSnippetBlock(modRef(true), fileDiffs(rows), true))
        .querySelector("details")
        ?.hasAttribute("open"),
    ).toBe(false);
  });

  it("wraps long lines for a prose/doc file instead of scrolling", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const proseFileDiffs = new Map([["docs/readme.md", { rows, embeddable: true }]]);
    const ref: SnippetRef = { path: "docs/readme.md", head: { start: 1, end: 1 }, unfold: true };
    const scrollDiv = parse(renderSnippetBlock(ref, proseFileDiffs)).querySelector(
      ".snippet-scroll",
    );
    expect(scrollDiv?.classList.contains("snippet-wrap")).toBe(true);
  });

  it("keeps the scrolling (no-wrap) behavior for a code file", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const scrollDiv = parse(renderSnippetBlock(modRef(true), fileDiffs(rows))).querySelector(
      ".snippet-scroll",
    );
    expect(scrollDiv?.classList.contains("snippet-wrap")).toBe(false);
  });

  it("wraps the diff table in a horizontally-scrollable container", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    expect(
      parse(renderSnippetBlock(modRef(true), fileDiffs(rows))).querySelector(
        ".snippet-scroll > .snippet-table",
      ),
    ).not.toBeNull();
  });
});

describe("renderSnippetBlock — range-based expand", () => {
  // A file with unchanged context above and below a single-line modification (line 5).
  function fileWithChangeAtLine5(): AlignedRow[] {
    const base = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join("\n");
    const head = base.replace("l5", "L5");
    return buildAlignedDiff(`${base}\n`, `${head}\n`);
  }

  const line5Ref: SnippetRef = {
    path: "src/a.ts",
    base: { start: 5, end: 5 },
    head: { start: 5, end: 5 },
    unfold: true,
  };

  it("offers both expand controls when unhidden context exists on both edges", () => {
    const html = renderSnippetBlock(line5Ref, fileDiffs(fileWithChangeAtLine5(), true));
    expect(parse(html).querySelectorAll(".snippet-expand")).toHaveLength(2);
  });

  it("shows no expand controls when the file is over the embed cap", () => {
    const html = renderSnippetBlock(line5Ref, fileDiffs(fileWithChangeAtLine5(), false));
    expect(parse(html).querySelectorAll(".snippet-expand")).toHaveLength(0);
  });

  it("records the reference's base/head line bounds and pane mode as data attributes", () => {
    const container = parse(
      renderSnippetBlock(line5Ref, fileDiffs(fileWithChangeAtLine5(), true)),
    ).querySelector(".snippet");
    expect(container?.getAttribute("data-path")).toBe("src/a.ts");
    expect(container?.getAttribute("data-base-start")).toBe("5");
    expect(container?.getAttribute("data-base-end")).toBe("5");
    expect(container?.getAttribute("data-head-start")).toBe("5");
    expect(container?.getAttribute("data-head-end")).toBe("5");
    expect(container?.getAttribute("data-pane-mode")).toBe("split");
  });

  it("omits the up control at the top of the file and the down control at the bottom", () => {
    // Change on line 1 (top): base l1 -> head L1, lines 2-3 context.
    const topRows = buildAlignedDiff("l1\nl2\nl3\n", "L1\nl2\nl3\n");
    const topRef: SnippetRef = {
      path: "src/a.ts",
      base: { start: 1, end: 1 },
      head: { start: 1, end: 1 },
      unfold: true,
    };
    const top = parse(renderSnippetBlock(topRef, fileDiffs(topRows, true)));
    expect(top.querySelectorAll('.snippet-expand[data-dir="up"]')).toHaveLength(0);
    expect(top.querySelectorAll('.snippet-expand[data-dir="down"]')).toHaveLength(1);

    // Change on the last line (line 3).
    const botRows = buildAlignedDiff("l1\nl2\nl3\n", "l1\nl2\nL3\n");
    const botRef: SnippetRef = {
      path: "src/a.ts",
      base: { start: 3, end: 3 },
      head: { start: 3, end: 3 },
      unfold: true,
    };
    const bottom = parse(renderSnippetBlock(botRef, fileDiffs(botRows, true)));
    expect(bottom.querySelectorAll('.snippet-expand[data-dir="up"]')).toHaveLength(1);
    expect(bottom.querySelectorAll('.snippet-expand[data-dir="down"]')).toHaveLength(0);
  });

  it("shows no control at a split interior seam (the adjacent row is a sibling changed line)", () => {
    // Lines 5 and 6 both modified; piece A references only line 5. Below it is line 6 (a changed
    // row, the sibling piece) — no hidden context, so no down control. Above is context.
    const base = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join("\n");
    const head = base.replace("l5", "L5").replace("l6", "L6");
    const rows = buildAlignedDiff(`${base}\n`, `${head}\n`);
    const pieceA: SnippetRef = {
      path: "src/a.ts",
      base: { start: 5, end: 5 },
      head: { start: 5, end: 5 },
      unfold: true,
    };
    const root = parse(renderSnippetBlock(pieceA, fileDiffs(rows, true)));
    expect(root.querySelectorAll('.snippet-expand[data-dir="up"]')).toHaveLength(1);
    expect(root.querySelectorAll('.snippet-expand[data-dir="down"]')).toHaveLength(0);
  });
});

describe("renderSnippetBlock — metadata and fallbacks", () => {
  const modRef: SnippetRef = {
    path: "src/a.ts",
    base: { start: 1, end: 1 },
    head: { start: 1, end: 1 },
    unfold: true,
  };

  it("records the file's guessed highlight.js language as a data attribute", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    expect(
      parse(renderSnippetBlock(modRef, fileDiffs(rows)))
        .querySelector(".snippet")
        ?.getAttribute("data-lang"),
    ).toBe("typescript");
  });

  it("omits the language data attribute for an unrecognized extension", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const ref: SnippetRef = {
      path: "src/a.xyz123",
      base: { start: 1, end: 1 },
      head: { start: 1, end: 1 },
      unfold: true,
    };
    const map = new Map([["src/a.xyz123", { rows, embeddable: true }]]);
    expect(
      parse(renderSnippetBlock(ref, map)).querySelector(".snippet")?.hasAttribute("data-lang"),
    ).toBe(false);
  });

  it("falls back gracefully when the file has no diff data", () => {
    const html = renderSnippetBlock(modRef, new Map());
    expect(html).toContain("could not be loaded");
    expect(html).toContain("src/a.ts");
  });

  it("falls back gracefully when the referenced range isn't found in the diff", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const ref: SnippetRef = {
      path: "src/a.ts",
      base: { start: 99, end: 99 },
      head: { start: 99, end: 99 },
      unfold: true,
    };
    expect(renderSnippetBlock(ref, fileDiffs(rows))).toContain("could not be located");
  });

  it("escapes untrusted file content", () => {
    const rows = buildAlignedDiff("<script>x</script>\n", "<script>y</script>\n");
    const ref: SnippetRef = {
      path: "src/a.ts",
      base: { start: 1, end: 1 },
      head: { start: 1, end: 1 },
      unfold: true,
    };
    const html = renderSnippetBlock(ref, fileDiffs(rows));
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
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
