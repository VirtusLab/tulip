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
    prDescription: `PR description prose.\n\n> A blockquote in the PR description.\n\n${snippetRef}\n`,
    prUrl: "https://github.com/a/b/pull/1",
    fileDiffs,
    explanations: [
      {
        category: { id: "c1", name: "Auth", description: "d" },
        markdown: `Intro prose.\n\n${snippetRef}\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n\n\`\`\`mermaid\ngraph TD\nA-->B\n\`\`\`\n\n## Production code\n\nBody.\n`,
      },
    ],
  });

  return loadIntoJsdom(html);
}

/** Renders a page with no category explanations at all — just the PR description — to check
 * the last-section-loses-its-border rule (see docs/adr/0007's amendment) in that edge case too. */
function renderIntoJsdomNoCategories(): Document {
  const html = renderPage({
    prTitle: "t",
    prDescription: "PR description prose.",
    prUrl: "https://github.com/a/b/pull/1",
    fileDiffs: new Map(),
    explanations: [],
  });
  return loadIntoJsdom(html);
}

function loadIntoJsdom(html: string): Document {
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

function mustQuery(doc: Document, selector: string): Element {
  const el = doc.querySelector(selector);
  if (!el) {
    throw new Error(`element not found: ${selector}`);
  }
  return el;
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

  it("gives a nested .snippet the full-width span, inside the PR description", () => {
    const doc = renderIntoJsdom();
    const snippet = doc.querySelector("#pr-description > .snippet");
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

describe("style.css layout — spacing/alignment fixes (real CSS, real DOM)", () => {
  it("zeroes a blockquote's inline margin so it shares the same left edge as a paragraph", () => {
    const doc = renderIntoJsdom();
    const blockquote = doc.querySelector("blockquote");
    if (!blockquote) {
      throw new Error("expected a blockquote in the PR description fixture");
    }
    const style = getComputedStyle(blockquote);
    // jsdom (no real layout engine) reports an unresolved zero length as "0" rather than "0px".
    expect(style.marginLeft).toMatch(/^0(px)?$/);
    expect(style.marginRight).toMatch(/^0(px)?$/);
  });

  it("doesn't double a section heading's top gap against its .page-section's own padding", () => {
    const doc = renderIntoJsdom();
    const heading = doc.querySelector("#pr-description > h2");
    const section = doc.querySelector("#pr-description");
    if (!heading || !section) {
      throw new Error("expected #pr-description and its heading");
    }
    // Grid items never margin-collapse with their container's padding (unlike normal block
    // flow) — h2's own margin-top must be zeroed so the only gap above it is the section's own
    // padding-top, not padding-top *plus* h2's margin-top stacked on top of it.
    expect(getComputedStyle(heading).marginTop).toBe("0px");
    expect(getComputedStyle(section).paddingTop).not.toBe("0px");
  });

  it("drops the trailing border from the last section, even when it's the PR description with no categories", () => {
    const withCategory = renderIntoJsdom();
    const prDescription = withCategory.querySelector("#pr-description");
    const category = withCategory.querySelector("#category-0");
    if (!prDescription || !category) {
      throw new Error("expected both #pr-description and #category-0");
    }
    // Not last (a category follows it) — still matches `.page-section` but not `:last-of-type`.
    expect(prDescription.matches(".page-section:last-of-type")).toBe(false);
    expect(category.matches(".page-section:last-of-type")).toBe(true);

    const noCategories = renderIntoJsdomNoCategories();
    const onlySection = noCategories.querySelector("#pr-description");
    if (!onlySection) {
      throw new Error("expected #pr-description");
    }
    // With zero categories, the PR description is itself the last (and only) section.
    expect(onlySection.matches(".page-section:last-of-type")).toBe(true);
  });
});

describe("style.css layout — vertical rhythm (real CSS, real DOM)", () => {
  // jsdom's CSS engine resolves a `var(...)` reference for a longhand property like
  // `margin-top` to the literal, unresolved token (never a computed px value) — good enough to
  // distinguish which spacing-scale step a rule applies (or that a rule was zeroed to "0px"),
  // which is all these checks need.
  it("zeroes a section/category heading's own margin so it doesn't double the section's padding", () => {
    const doc = renderIntoJsdom();
    const categoryHeading = mustQuery(doc, "#category-0 > h2");
    expect(getComputedStyle(categoryHeading).marginTop).toBe("0px");
  });

  it("gives a category's description a tighter caption gap than the general paragraph rhythm", () => {
    const doc = renderIntoJsdom();
    const description = mustQuery(doc, "#category-0 > .category-description");
    const introParagraph = mustQuery(doc, "#category-0 > p:not(.category-description)");
    expect(getComputedStyle(description).marginTop).toBe("var(--space-1)");
    expect(getComputedStyle(introParagraph).marginTop).toBe("var(--space-2)");
  });

  it("gives a subsection a bigger jump than the general paragraph rhythm", () => {
    const doc = renderIntoJsdom();
    const subsection = mustQuery(doc, ".subsection");
    expect(getComputedStyle(subsection).marginTop).toBe("var(--space-3)");
  });

  it("zeroes a subsection's own h3 margin so it doesn't double the subsection's own margin-top", () => {
    const doc = renderIntoJsdom();
    const subsectionHeading = mustQuery(doc, ".subsection > h3");
    expect(getComputedStyle(subsectionHeading).marginTop).toBe("0px");
  });

  it("never gives a top-level section/category/subsection child a margin-bottom (rhythm is margin-top only)", () => {
    const doc = renderIntoJsdom();
    const description = mustQuery(doc, "#category-0 > .category-description");
    expect(getComputedStyle(description).marginBottom).toBe("0px");
  });
});

describe("style.css layout — mermaid diagram centering (real CSS, real DOM)", () => {
  // jsdom has no real layout engine, so it can't report an svg's actual rendered pixel
  // position — these tests instead confirm the CSS *mechanism* (mirroring how this file
  // already checks grid-column/margin outcomes rather than pixel geometry).
  it("center-aligns the mermaid diagram's container", () => {
    const doc = renderIntoJsdom();
    const pre = doc.querySelector("pre.mermaid");
    if (!pre) {
      throw new Error("expected a pre.mermaid placeholder in the fixture");
    }
    expect(getComputedStyle(pre).textAlign).toBe("center");
  });

  it("centers regardless of theme", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    try {
      const doc = renderIntoJsdom();
      const pre = doc.querySelector("pre.mermaid");
      if (!pre) {
        throw new Error("expected a pre.mermaid placeholder in the fixture");
      }
      expect(getComputedStyle(pre).textAlign).toBe("center");
    } finally {
      document.documentElement.removeAttribute("data-theme");
    }
  });

  it("doesn't override mermaid's own inline max-width on a large diagram's rendered svg", () => {
    const doc = renderIntoJsdom();
    const pre = doc.querySelector("pre.mermaid");
    if (!pre) {
      throw new Error("expected a pre.mermaid placeholder in the fixture");
    }
    // Simulates what assets/app.js's setupMermaid does at runtime: mermaid replaces the
    // placeholder's text content with a rendered <svg width="100%" style="max-width: ...px">
    // (see mermaid's `useMaxWidth` config, default on) — a diagram whose natural size exceeds
    // the container should keep growing to the container's width, capped only by that inline
    // style, never by a competing rule from this stylesheet.
    pre.innerHTML = '<svg width="100%" style="max-width: 900px;" height="200"></svg>';
    const svg = pre.querySelector("svg");
    if (!svg) {
      throw new Error("expected the inserted svg");
    }
    expect(getComputedStyle(svg).maxWidth).toBe("900px");
  });
});
