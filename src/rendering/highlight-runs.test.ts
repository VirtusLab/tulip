import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeSnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { buildAlignedDiff } from "./line-diff.js";
import { mountWithAppJs, renderFixturePage } from "./page.fixture.js";

// Built by vitest.config.ts's globalSetup — see highlight-safety.test.ts for why it's not a
// beforeAll here.
const BUNDLE_PATH = join(import.meta.dirname, "assets/vendor/highlight.min.js");
const PATH = "src/a.ts";

/** Mounts a page with one snippet over a TypeScript file whose head side is `head` (its base
 * side `base`), showing head lines `from`-`to`, with the real highlight.js loaded before app.js
 * runs. Returns the snippet block. */
function mount(base: string, head: string, from: number, to: number): Element {
  if (!existsSync(BUNDLE_PATH)) {
    throw new Error(`expected vitest's globalSetup to have built ${BUNDLE_PATH}`);
  }
  const hljsSource = readFileSync(BUNDLE_PATH, "utf8");
  const ref = serializeSnippetRef({
    path: PATH,
    head: { start: from, end: to },
    unfold: true,
  });
  const fileDiffs = new Map<string, FileDiffData>([
    [PATH, { rows: buildAlignedDiff(base, head), embeddable: true }],
  ]);
  const html = renderFixturePage({ markdown: `Intro.\n\n${ref}\n`, fileDiffs });
  const win = mountWithAppJs(html, {
    prepare(prepWin) {
      prepWin.eval(hljsSource);
      if (!("hljs" in prepWin)) {
        throw new Error("the highlight.js bundle did not attach itself to the window");
      }
    },
  });
  const container = win.document.querySelector(".snippet");
  if (!container) {
    throw new Error("expected a snippet block");
  }
  return container;
}

function headCodes(container: Element): Element[] {
  return Array.from(container.querySelectorAll(".snippet-cell-head code"));
}

const COMMENT = "/**\n * Doc line.\n * Another.\n */\nconst a = 1;\n";

describe("run-based snippet highlighting (real highlight.js, app.js under jsdom)", () => {
  it("keeps a block comment's state across the cells it spans", () => {
    const container = mount("const a = 1;\n", COMMENT, 1, 5);
    const codes = headCodes(container);
    expect(codes.map((code) => code.textContent)).toEqual([
      "/**",
      " * Doc line.",
      " * Another.",
      " */",
      "const a = 1;",
    ]);
    expect(codes[1]?.innerHTML).toContain("hljs-comment");
    expect(codes[2]?.innerHTML).toContain("hljs-comment");
    expect(codes[3]?.innerHTML).toContain("hljs-comment");
    expect(codes[4]?.innerHTML).not.toContain("hljs-comment");
    expect(codes[4]?.innerHTML).toContain("hljs-keyword");
    for (const code of codes) {
      expect(code.getAttribute("data-highlighted")).toBe("yes");
      expect(code.classList.contains("language-typescript")).toBe(true);
    }
  });

  it("re-highlights a run once a gap expansion reveals the lines above it", () => {
    // Lines 1-9 padding, a comment over 10-14, then code: the snippet shows only line 12.
    const lines = Array.from({ length: 9 }, (_, i) => `const p${i} = ${i};`);
    lines.push("/**", " * one", " * two", " * three", " */", "const z = 0;");
    const file = `${lines.join("\n")}\n`;
    const container = mount(file, file, 12, 12);
    const before = headCodes(container);
    expect(before).toHaveLength(1);
    expect(before[0]?.textContent).toBe(" * two");
    expect(before[0]?.innerHTML).not.toContain("hljs-comment");

    const button = container.querySelector(
      'tr.snippet-gap[data-position="top"] .snippet-gap-btn[data-dir="all"]',
    );
    if (!button) {
      throw new Error("expected an expand-all button on the top gap");
    }
    (button as HTMLElement).click();
    const after = headCodes(container);
    expect(after.map((code) => code.textContent)).toEqual(lines.slice(0, 12));
    expect(after[11]?.textContent).toBe(" * two");
    expect(after[11]?.innerHTML).toContain("hljs-comment");
  });

  it("keeps every line of a CRLF file, and highlights its comment lines", () => {
    // The HTML parser turns a cell's trailing `\r` into a newline, which must not shift or
    // blank any cell when the run is split back per line.
    const crlf = COMMENT.replace(/\n/g, "\r\n");
    const container = mount("const a = 1;\r\n", crlf, 1, 5);
    const codes = headCodes(container);
    expect(codes.map((code) => code.textContent?.replace(/\n/g, ""))).toEqual([
      "/**",
      " * Doc line.",
      " * Another.",
      " */",
      "const a = 1;",
    ]);
    expect(codes[1]?.innerHTML).toContain("hljs-comment");
    expect(codes[2]?.innerHTML).toContain("hljs-comment");
    expect(codes[4]?.innerHTML).toContain("hljs-keyword");
  });

  it("keeps a </script>/<img onerror> payload inside a comment as inert text", () => {
    const payload = `</script><img src=x onerror="alert(1)">`;
    const head = `/**\n * ${payload}\n */\nconst a = 1;\n`;
    const container = mount("const a = 1;\n", head, 1, 4);
    const doc = container.ownerDocument;
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelectorAll("script").length).toBe(
      doc.querySelectorAll('script[type="application/json"], script[src]').length,
    );
    const line = headCodes(container)[1];
    expect(line?.textContent).toBe(` * ${payload}`);
    expect(line?.innerHTML).toContain("hljs-comment");
  });
});
