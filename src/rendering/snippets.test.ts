import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";
import type { SnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { type AlignedRow, buildAlignedDiff } from "./line-diff.js";
import type { GapPosition, SnippetPaneMode } from "./snippet-blocks.js";
import { EXPAND_STEP, renderGapRow, renderSnippetRow, renderSnippetRun } from "./snippets.js";

function fileDiffs(
  rows: FileDiffData["rows"],
  embeddable = true,
  path = "src/a.ts",
): Map<string, FileDiffData> {
  return new Map([[path, { rows, embeddable }]]);
}

describe("renderSnippetRun — per-region alignment", () => {
  it("renders a modification (both sides) as one paired before/after row", () => {
    const rows = buildAlignedDiff("a\nb\nc\n", "a\nB\nc\n");
    const ref: SnippetRef = {
      path: "src/a.ts",
      base: { start: 2, end: 2 },
      head: { start: 2, end: 2 },
      unfold: true,
    };
    const root = parse(renderSnippetRun([ref], fileDiffs(rows)));
    const trs = root.querySelectorAll("tr:not(.snippet-gap)");
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
    const trs = parse(renderSnippetRun([ref], fileDiffs(rows))).querySelectorAll("tr");
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
    const trs = parse(renderSnippetRun([ref], fileDiffs(rows))).querySelectorAll("tr");
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
    const trs = parse(renderSnippetRun([ref], fileDiffs(rows))).querySelectorAll(
      "tr:not(.snippet-gap)",
    );
    expect(trs).toHaveLength(1);
    expect(trs[0]?.querySelector(".snippet-line-no.side-base")?.text).toBe("40");
    expect(trs[0]?.querySelector(".snippet-line-no.side-head")?.text).toBe("40");
  });

  it("renders an addition ref as a head-only single pane", () => {
    const rows = buildAlignedDiff("", "line1\nline2\n");
    const ref: SnippetRef = { path: "src/a.ts", head: { start: 1, end: 2 }, unfold: true };
    const root = parse(renderSnippetRun([ref], fileDiffs(rows)));
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
    const root = parse(renderSnippetRun([ref], fileDiffs(rows)));
    expect(root.querySelector(".snippet")?.getAttribute("data-pane-mode")).toBe("base-only");
    const trs = root.querySelectorAll("tr");
    expect(trs).toHaveLength(2);
    for (const tr of trs) {
      expect(tr.querySelectorAll("td")).toHaveLength(3);
      expect(tr.querySelector(".snippet-cell-head")).toBeNull();
      expect(tr.querySelector(".snippet-marker")?.text).toBe("-");
    }
  });

  it("renders a pure add inside a two-sided file in split mode (pane follows the file, not the ref)", () => {
    // A modified file (both sides have content), but the ref is a head-only addition. The block's
    // pane mode still follows the whole file, not this one ref, so a gap row can later reveal
    // two-sided context without going blank in a single-pane layout.
    const rows = buildAlignedDiff("a\nc\n", "a\nb\nc\n");
    const ref: SnippetRef = { path: "src/a.ts", head: { start: 2, end: 2 }, unfold: true };
    const root = parse(renderSnippetRun([ref], fileDiffs(rows)));
    expect(root.querySelector(".snippet")?.getAttribute("data-pane-mode")).toBe("split");
    const trs = root.querySelectorAll("tr:not(.snippet-gap)");
    expect(trs[0]?.querySelectorAll("td")).toHaveLength(6);
  });
});

describe("renderSnippetRun — fold/unfold and wrapping", () => {
  const modRef = (unfold: boolean): SnippetRef => ({
    path: "src/a.ts",
    base: { start: 1, end: 1 },
    head: { start: 1, end: 1 },
    unfold,
  });

  it("is open by default when unfold is true", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    expect(
      parse(renderSnippetRun([modRef(true)], fileDiffs(rows)))
        .querySelector("details")
        ?.hasAttribute("open"),
    ).toBe(true);
  });

  it("is collapsed by default when unfold is false, showing a line count", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const details = parse(renderSnippetRun([modRef(false)], fileDiffs(rows))).querySelector(
      "details",
    );
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.text).toContain("1 line");
  });

  it("forces the details closed when forceCollapsed is set, even with unfold=yes", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    expect(
      parse(renderSnippetRun([modRef(true)], fileDiffs(rows), true))
        .querySelector("details")
        ?.hasAttribute("open"),
    ).toBe(false);
  });

  it("wraps long lines for a prose/doc file instead of scrolling", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const proseFileDiffs = new Map([["docs/readme.md", { rows, embeddable: true }]]);
    const ref: SnippetRef = { path: "docs/readme.md", head: { start: 1, end: 1 }, unfold: true };
    const scrollDiv = parse(renderSnippetRun([ref], proseFileDiffs)).querySelector(
      ".snippet-scroll",
    );
    expect(scrollDiv?.classList.contains("snippet-wrap")).toBe(true);
  });

  it("keeps the scrolling (no-wrap) behavior for a code file", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const scrollDiv = parse(renderSnippetRun([modRef(true)], fileDiffs(rows))).querySelector(
      ".snippet-scroll",
    );
    expect(scrollDiv?.classList.contains("snippet-wrap")).toBe(false);
  });

  it("wraps the diff table in a horizontally-scrollable container", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    expect(
      parse(renderSnippetRun([modRef(true)], fileDiffs(rows))).querySelector(
        ".snippet-scroll > .snippet-table",
      ),
    ).not.toBeNull();
  });
});

describe("renderSnippetRun — merged regions and gap rows", () => {
  /** A file of `n` lines `l1..ln`; `modified` lines are upper-cased on the head side. */
  function modifiedFile(n: number, modified: number[]): AlignedRow[] {
    const base = Array.from({ length: n }, (_, i) => `l${i + 1}`);
    const head = base.map((line, i) => (modified.includes(i + 1) ? line.toUpperCase() : line));
    return buildAlignedDiff(`${base.join("\n")}\n`, `${head.join("\n")}\n`);
  }

  function modRef(line: number): SnippetRef {
    return {
      path: "src/a.ts",
      base: { start: line, end: line },
      head: { start: line, end: line },
      unfold: true,
    };
  }

  it("renders two adjacent refs as one block with labelled, two-way gap rows between them", () => {
    const root = parse(
      renderSnippetRun([modRef(5), modRef(30)], fileDiffs(modifiedFile(60, [5, 30]))),
    );
    expect(root.querySelectorAll(".snippet")).toHaveLength(1);
    const gaps = root.querySelectorAll("tr.snippet-gap");
    expect(gaps.map((gap) => gap.getAttribute("data-position"))).toEqual([
      "top",
      "between",
      "bottom",
    ]);
    const between = gaps[1];
    expect(between?.querySelector(".snippet-gap-label")?.text).toBe("⋯ 24 lines");
    expect(
      between?.querySelectorAll(".snippet-gap-btn").map((b) => b.getAttribute("data-dir")),
    ).toEqual(["up", "down"]);
    // Regions keep their own rows: line 5 and line 30, nothing in between.
    const headLines = root.querySelectorAll("td.snippet-line-no.side-head").map((td) => td.text);
    expect(headLines).toEqual(["5", "30"]);
  });

  it("renders a single button for a gap of at most EXPAND_STEP rows", () => {
    const root = parse(
      renderSnippetRun([modRef(5), modRef(10)], fileDiffs(modifiedFile(60, [5, 10]))),
    );
    const between = root.querySelectorAll("tr.snippet-gap")[1];
    const buttons = between?.querySelectorAll(".snippet-gap-btn") ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute("data-dir")).toBe("all");
    expect(buttons[0]?.text).toBe("expand 4 lines");
  });

  it("gives the top gap only an up button and the bottom gap only a down button", () => {
    const root = parse(renderSnippetRun([modRef(30)], fileDiffs(modifiedFile(60, [30]))));
    const [top, bottom] = root.querySelectorAll("tr.snippet-gap");
    expect(
      top?.querySelectorAll(".snippet-gap-btn").map((b) => b.getAttribute("data-dir")),
    ).toEqual(["up"]);
    expect(
      bottom?.querySelectorAll(".snippet-gap-btn").map((b) => b.getAttribute("data-dir")),
    ).toEqual(["down"]);
  });

  it("renders no top or bottom gap and no buttons when the file is over the embed cap", () => {
    const root = parse(
      renderSnippetRun([modRef(5), modRef(30)], fileDiffs(modifiedFile(60, [5, 30]), false)),
    );
    const gaps = root.querySelectorAll("tr.snippet-gap");
    expect(gaps.map((gap) => gap.getAttribute("data-position"))).toEqual(["between"]);
    expect(root.querySelectorAll(".snippet-gap-btn")).toHaveLength(0);
    expect(gaps[0]?.querySelector(".snippet-gap-label")?.text).toBe("⋯ 24 lines");
  });

  it("renders contiguous split pieces with no gap between them", () => {
    const root = parse(
      renderSnippetRun([modRef(5), modRef(6)], fileDiffs(modifiedFile(10, [5, 6]))),
    );
    expect(
      root.querySelectorAll("tr.snippet-gap").map((g) => g.getAttribute("data-position")),
    ).toEqual(["top", "bottom"]);
    expect(root.querySelectorAll("td.snippet-line-no.side-head").map((td) => td.text)).toEqual([
      "5",
      "6",
    ]);
  });

  it("emits a colgroup matching the pane mode so fixed-layout tables keep gutter widths", () => {
    const split = parse(renderSnippetRun([modRef(5)], fileDiffs(modifiedFile(10, [5]))));
    expect(split.querySelectorAll("colgroup col")).toHaveLength(6);
    const added = buildAlignedDiff("", "a\nb\n");
    const addRef: SnippetRef = { path: "src/a.ts", head: { start: 1, end: 1 }, unfold: true };
    const single = parse(renderSnippetRun([addRef], fileDiffs(added)));
    expect(single.querySelectorAll("colgroup col")).toHaveLength(3);
  });

  it("summarizes every region's ranges and the total line count", () => {
    const root = parse(
      renderSnippetRun([modRef(5), modRef(30)], fileDiffs(modifiedFile(60, [5, 30]))),
    );
    expect(root.querySelector("summary")?.text).toBe(
      "src/a.ts — base 5-5, head 5-5; base 30-30, head 30-30 (2 lines)",
    );
  });

  it("carries no per-block line bounds; the gap rows own the hidden ranges", () => {
    const root = parse(renderSnippetRun([modRef(5)], fileDiffs(modifiedFile(10, [5]))));
    const container = root.querySelector(".snippet");
    expect(container?.getAttribute("data-base-start")).toBeUndefined();
    expect(container?.getAttribute("data-head-start")).toBeUndefined();
  });

  it("renders a failed middle ref as a fallback between two blocks", () => {
    const html = renderSnippetRun(
      [modRef(5), modRef(99), modRef(30)],
      fileDiffs(modifiedFile(60, [5, 30])),
    );
    const root = parse(html);
    expect(root.querySelectorAll(".snippet:not(.snippet-unavailable)")).toHaveLength(2);
    expect(root.querySelectorAll(".snippet-unavailable")).toHaveLength(1);
  });
});

describe("renderSnippetRun — metadata and fallbacks", () => {
  const modRef: SnippetRef = {
    path: "src/a.ts",
    base: { start: 1, end: 1 },
    head: { start: 1, end: 1 },
    unfold: true,
  };

  it("records the file's guessed highlight.js language as a data attribute", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    expect(
      parse(renderSnippetRun([modRef], fileDiffs(rows)))
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
      parse(renderSnippetRun([ref], map))
        .querySelector(".snippet")
        ?.hasAttribute("data-lang"),
    ).toBe(false);
  });

  it("falls back gracefully when the file has no diff data", () => {
    const html = renderSnippetRun([modRef], new Map());
    expect(html).toContain("could not be loaded");
    expect(html).toContain("src/a.ts");
  });

  it("escapes the model-written path in the fallback notice", () => {
    const ref: SnippetRef = { ...modRef, path: "<img src=x onerror=alert(1)>.ts" };
    const html = renderSnippetRun([ref], new Map());
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;.ts could not be loaded.");
  });

  it("falls back gracefully when the referenced range isn't found in the diff", () => {
    const rows = buildAlignedDiff("a\n", "A\n");
    const ref: SnippetRef = {
      path: "src/a.ts",
      base: { start: 99, end: 99 },
      head: { start: 99, end: 99 },
      unfold: true,
    };
    expect(renderSnippetRun([ref], fileDiffs(rows))).toContain("could not be located");
  });

  it("escapes untrusted file content", () => {
    const rows = buildAlignedDiff("<script>x</script>\n", "<script>y</script>\n");
    const ref: SnippetRef = {
      path: "src/a.ts",
      base: { start: 1, end: 1 },
      head: { start: 1, end: 1 },
      unfold: true,
    };
    const html = renderSnippetRun([ref], fileDiffs(rows));
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

interface ClientRenderers {
  renderSnippetRow: (row: AlignedRow, paneMode?: SnippetPaneMode) => string;
  renderGapRow: (
    fromRow: number,
    toRow: number,
    position: GapPosition,
    paneMode: SnippetPaneMode,
    embeddable: boolean,
  ) => string;
  EXPAND_STEP: number;
}

// ./assets/app.js's `renderSnippetRow` and `renderGapRow` are hand-maintained mirrors of the
// functions exported from this module (the client inserts rows and re-renders gap rows without
// a server round-trip — see setupSnippetExpansion in app.js). Nothing in the type system
// enforces the two stay identical, so this loads app.js's actual source, evaluates just its
// rendering block in Node (no DOM needed), and asserts both produce the same HTML.
function loadClientRenderers(): ClientRenderers {
  const appJsPath = fileURLToPath(new URL("./assets/app.js", import.meta.url));
  const source = readFileSync(appJsPath, "utf8");

  const start = source.indexOf("// --- mirrored from snippets.ts: BEGIN ---");
  const end = source.indexOf("// --- mirrored from snippets.ts: END ---");
  if (start === -1 || end === -1) {
    throw new Error(
      "could not locate the row-rendering block in assets/app.js — parity test needs updating",
    );
  }

  const factory = new Function(
    `${source.slice(start, end)}\nreturn { renderSnippetRow, renderGapRow, EXPAND_STEP };`,
  );
  return factory() as ClientRenderers;
}

describe("snippets.ts / assets/app.js parity", () => {
  it("renders byte-identical row HTML to assets/app.js's client-side row renderer", () => {
    const client = loadClientRenderers();
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
        expect(client.renderSnippetRow(row, paneMode)).toBe(renderSnippetRow(row, paneMode));
      }
      expect(client.renderSnippetRow(row)).toBe(renderSnippetRow(row));
    }
  });

  it("renders byte-identical gap rows and shares the expansion step", () => {
    const client = loadClientRenderers();
    expect(client.EXPAND_STEP).toBe(EXPAND_STEP);
    const positions: GapPosition[] = ["top", "between", "bottom"];
    const paneModes: SnippetPaneMode[] = ["split", "head-only", "base-only"];
    const ranges: [number, number][] = [
      [0, 0],
      [3, 22],
      [3, 23],
      [40, 199],
    ];
    for (const [from, to] of ranges) {
      for (const position of positions) {
        for (const paneMode of paneModes) {
          for (const embeddable of [true, false]) {
            expect(client.renderGapRow(from, to, position, paneMode, embeddable)).toBe(
              renderGapRow(from, to, position, paneMode, embeddable),
            );
          }
        }
      }
    }
  });
});
