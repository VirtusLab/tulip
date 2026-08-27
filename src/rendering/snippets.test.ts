import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";
import type { SnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { buildAlignedDiff } from "./line-diff.js";
import { renderSnippetBlock } from "./snippets.js";

function ref(overrides: Partial<SnippetRef> = {}): SnippetRef {
  return {
    path: "src/a.ts",
    side: "head",
    lines: { start: 2, end: 2 },
    unfold: true,
    ...overrides,
  };
}

function fileDiffs(rows: FileDiffData["rows"], embeddable = true): Map<string, FileDiffData> {
  return new Map([["src/a.ts", { rows, embeddable }]]);
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
