import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { serializeSnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { buildAlignedDiff } from "./line-diff.js";
import { renderPage } from "./template.js";

// `import.meta.dirname`, not `new URL(..., import.meta.url)` — see highlight-safety.test.ts.
const APP_JS = readFileSync(`${import.meta.dirname}/assets/app.js`, "utf8");
const PATH = "src/a.ts";

/** A 60-line file with single-line modifications at 10, 30 and 50, so whole-file row index
 * `i` holds line `i + 1` on both sides. */
function fixtureRows() {
  const base = Array.from({ length: 60 }, (_, i) => `l${i + 1}`);
  const head = base.map((line, i) => ([10, 30, 50].includes(i + 1) ? line.toUpperCase() : line));
  return buildAlignedDiff(`${base.join("\n")}\n`, `${head.join("\n")}\n`);
}

function ref(line: number): string {
  return serializeSnippetRef({
    path: PATH,
    base: { start: line, end: line },
    head: { start: line, end: line },
    unfold: true,
  });
}

/** Renders a real page with a merged block for lines 10 and 30, loads it into its own JSDOM
 * window, runs the real app.js there, and fires DOMContentLoaded — one window per test, so
 * listeners never accumulate across tests. No <script src> is fetched by JSDOM. */
function mount(): { window: JSDOM["window"]; container: Element } {
  const fileDiffs = new Map<string, FileDiffData>([
    [PATH, { rows: fixtureRows(), embeddable: true }],
  ]);
  const html = renderPage({
    prTitle: "t",
    prDescription: "d",
    prUrl: "https://github.com/a/b/pull/1",
    fileDiffs,
    explanations: [
      {
        category: { id: "c1", name: "C", description: "d", attention: "normal" },
        markdown: `Intro.\n\n${ref(10)}\n\n${ref(30)}\n\n## Production code\n\nBody.\n`,
      },
    ],
  });
  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only" });
  dom.window.eval(APP_JS);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  const container = dom.window.document.querySelector(".snippet");
  if (!container) {
    throw new Error("expected a merged snippet block");
  }
  return { window: dom.window, container };
}

function headLines(container: Element): number[] {
  return Array.from(container.querySelectorAll("td.snippet-line-no.side-head"))
    .map((td) => Number(td.textContent))
    .filter((n) => n > 0);
}

function gap(container: Element, position: string): Element | null {
  return container.querySelector(`tr.snippet-gap[data-position="${position}"]`);
}

function click(container: Element, position: string, dir: string): void {
  const button = gap(container, position)?.querySelector(`.snippet-gap-btn[data-dir="${dir}"]`);
  if (!button || typeof (button as HTMLElement).click !== "function") {
    throw new Error(`no ${dir} button on the ${position} gap`);
  }
  (button as HTMLElement).click();
}

describe("gap-row expansion in a real DOM (app.js under jsdom)", () => {
  it("renders the two refs as one block with top, between and bottom gaps", () => {
    const { container } = mount();
    expect(container.ownerDocument.querySelectorAll(".snippet")).toHaveLength(1);
    expect(headLines(container)).toEqual([10, 30]);
    expect(gap(container, "top")?.getAttribute("data-to")).toBe("8");
    expect(gap(container, "between")?.getAttribute("data-from")).toBe("10");
    expect(gap(container, "between")?.getAttribute("data-to")).toBe("28");
    expect(gap(container, "bottom")?.getAttribute("data-from")).toBe("30");
  });

  it("expands a small between gap fully with one click, keeping file order", () => {
    const { container } = mount();
    click(container, "between", "all");
    expect(gap(container, "between")).toBeNull();
    expect(headLines(container)).toEqual(Array.from({ length: 21 }, (_, i) => 10 + i));
  });

  it("expands the top gap upward with one click", () => {
    const { container } = mount();
    click(container, "top", "all");
    expect(gap(container, "top")).toBeNull();
    expect(headLines(container).slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it("expands a large bottom gap in steps, crossing an unrelated change, until the file end", () => {
    const { container } = mount();
    click(container, "bottom", "down");
    expect(headLines(container)).toEqual([10, 30, ...Array.from({ length: 20 }, (_, i) => 31 + i)]);
    // Line 50 is a change explained elsewhere: revealed as a diff row, not hidden.
    const changed = Array.from(container.querySelectorAll("td.snippet-line-no.side-head.type-add"));
    expect(changed.map((td) => td.textContent)).toContain("50");
    // 10 rows remain: the gap re-rendered as a single button.
    const remaining = gap(container, "bottom");
    expect(remaining?.getAttribute("data-from")).toBe("50");
    expect(remaining?.querySelectorAll(".snippet-gap-btn")).toHaveLength(1);
    click(container, "bottom", "all");
    expect(gap(container, "bottom")).toBeNull();
    expect(headLines(container).at(-1)).toBe(60);
  });

  it("reveals every line exactly once after expanding everything", () => {
    const { container } = mount();
    click(container, "top", "all");
    click(container, "between", "all");
    click(container, "bottom", "down");
    click(container, "bottom", "all");
    expect(headLines(container)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(container.querySelectorAll("tr.snippet-gap")).toHaveLength(0);
    expect(container.querySelectorAll(".snippet-gap-btn")).toHaveLength(0);
  });
});
