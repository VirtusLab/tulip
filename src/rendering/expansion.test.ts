import { describe, expect, it } from "vitest";
import { serializeSnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { buildAlignedDiff } from "./line-diff.js";
import { mountWithAppJs, renderFixturePage } from "./page.fixture.js";

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

const DEFAULT_MARKDOWN = `Intro.\n\n${ref(10)}\n\n${ref(30)}\n\n## What changed\n\nBody.\n`;

/** Renders a real page from `markdown` (default: a merged block for lines 10 and 30) and mounts
 * it with the real app.js. Returns the page's first snippet block. */
function mount(markdown: string = DEFAULT_MARKDOWN): Element {
  const fileDiffs = new Map<string, FileDiffData>([
    [PATH, { rows: fixtureRows(), embeddable: true }],
  ]);
  const html = renderFixturePage({ markdown, fileDiffs });
  const win = mountWithAppJs(html);
  const container = win.document.querySelector(".snippet");
  if (!container) {
    throw new Error("expected a snippet block");
  }
  return container;
}

function lineNumbers(container: Element, side: "base" | "head"): number[] {
  return Array.from(container.querySelectorAll(`td.snippet-line-no.side-${side}`))
    .map((td) => Number(td.textContent))
    .filter((n) => n > 0);
}

function gap(container: Element, position: string): Element | null {
  return container.querySelector(`tr.snippet-gap[data-position="${position}"]`);
}

function click(container: Element, position: string, dir: string): void {
  const button = gap(container, position)?.querySelector(`.snippet-gap-btn[data-dir="${dir}"]`);
  if (!button) {
    throw new Error(`no ${dir} button on the ${position} gap`);
  }
  (button as HTMLElement).click();
}

describe("gap-row expansion in a real DOM (app.js under jsdom)", () => {
  it("expands a small between gap fully with one click, keeping file order", () => {
    const container = mount();
    click(container, "between", "all");
    expect(gap(container, "between")).toBeNull();
    expect(lineNumbers(container, "head")).toEqual(Array.from({ length: 21 }, (_, i) => 10 + i));
  });

  it("expands a large bottom gap in steps until the file end", () => {
    const container = mount();
    click(container, "bottom", "down");
    expect(lineNumbers(container, "head")).toEqual([
      10,
      30,
      ...Array.from({ length: 20 }, (_, i) => 31 + i),
    ]);
    expect(gap(container, "bottom")?.getAttribute("data-from-row")).toBe("50");
    click(container, "bottom", "all");
    expect(gap(container, "bottom")).toBeNull();
    expect(lineNumbers(container, "head").at(-1)).toBe(60);
  });

  it("reveals a change that belongs to another block as a diff row", () => {
    const container = mount();
    click(container, "bottom", "down");
    const changed = Array.from(container.querySelectorAll("td.snippet-line-no.side-head.type-add"));
    expect(changed.map((td) => td.textContent)).toContain("50");
  });

  it("expands a large top gap upward in steps, one step short of the file start", () => {
    const container = mount(`Intro.\n\n${ref(50)}\n\n## What changed\n\nBody.\n`);
    click(container, "top", "up");
    expect(lineNumbers(container, "head")).toEqual([
      ...Array.from({ length: 20 }, (_, i) => 30 + i),
      50,
    ]);
    expect(gap(container, "top")?.getAttribute("data-to-row")).toBe("28");
  });

  it("reveals every line exactly once after expanding everything", () => {
    const container = mount();
    click(container, "top", "all");
    click(container, "between", "all");
    click(container, "bottom", "down");
    click(container, "bottom", "all");
    const all = Array.from({ length: 60 }, (_, i) => i + 1);
    expect(lineNumbers(container, "head")).toEqual(all);
    expect(lineNumbers(container, "base")).toEqual(all);
    expect(container.querySelectorAll("tr.snippet-gap")).toHaveLength(0);
    expect(container.querySelectorAll(".snippet-gap-btn")).toHaveLength(0);
  });
});
