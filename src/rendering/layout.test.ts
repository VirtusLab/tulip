// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { serializeSnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import { buildAlignedDiff } from "./line-diff.js";
import { renderPage } from "./template.js";

// `import.meta.dirname` rather than `new URL(..., import.meta.url)` — under the jsdom test
// environment, `import.meta.url` isn't a `file:` URL (see highlight-safety.test.ts).
const CSS = readFileSync(`${import.meta.dirname}/assets/style.css`, "utf8");

/**
 * Renders a real page (category with a prose paragraph/snippet/subsection, plus a snippet
 * inside the PR description) and loads its `<body>` markup plus the REAL style.css into a jsdom
 * document, so `getComputedStyle` resolves the actual cascade — not a regex/text match against
 * the CSS source, which can't catch a selector-specificity bug (see docs/adr/0007's amendment:
 * an earlier version of this stylesheet paired `:is(#pr-header, ...)` with a lower-specificity
 * two-class override, which `:is()`'s highest-specificity-argument rule silently defeated
 * everywhere, even though every text-based assertion on the CSS source still passed).
 */
function renderIntoJsdom(): Document {
  const snippetRef = serializeSnippetRef({
    path: "src/a.ts",
    side: "head",
    lines: { start: 1, end: 1 },
    unfold: true,
  });
  const rows = buildAlignedDiff("a\n", "a\n");
  const fileDiffs = new Map<string, FileDiffData>([["src/a.ts", { rows, embeddable: true }]]);

  const html = renderPage({
    prTitle: "t",
    prDescription: "PR description prose.",
    prUrl: "https://github.com/a/b/pull/1",
    fileDiffs,
    explanations: [
      {
        category: { id: "c1", name: "Auth", description: "d" },
        markdown: `Intro prose.\n\n${snippetRef}\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n\n## Production code\n\nBody.\n`,
      },
    ],
  });

  const bodyMatch = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!bodyMatch?.[1]) {
    throw new Error("renderPage output has no <body> — test needs updating");
  }
  document.body.innerHTML = bodyMatch[1];
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  return document;
}

function gridColumn(el: Element | null): string {
  if (!el) {
    throw new Error("element not found");
  }
  return getComputedStyle(el).gridColumn;
}

describe("style.css layout — computed grid-column (real CSS, real DOM)", () => {
  it("gives a prose paragraph the centered column", () => {
    const doc = renderIntoJsdom();
    const p = doc.querySelector("#category-0 > p");
    expect(gridColumn(p)).toBe("2");
  });

  it("gives a nested .snippet the full-width span, inside a category", () => {
    const doc = renderIntoJsdom();
    const snippet = doc.querySelector("#category-0 > .snippet");
    expect(gridColumn(snippet)).toBe("1 / -1");
  });

  it("gives a nested <pre> (fenced code) the full-width span", () => {
    const doc = renderIntoJsdom();
    const pre = doc.querySelector("#category-0 > pre");
    expect(gridColumn(pre)).toBe("1 / -1");
  });

  it("gives a .subsection the full-width span", () => {
    const doc = renderIntoJsdom();
    const subsection = doc.querySelector(".subsection");
    expect(gridColumn(subsection)).toBe("1 / -1");
  });
});
