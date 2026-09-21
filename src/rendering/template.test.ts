import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";
import { serializeSnippetRef } from "../explanations/markup.js";
import type { CategoryExplanation } from "../explanations/types.js";
import type { FileDiffData } from "./file-diffs.js";
import { buildAlignedDiff } from "./line-diff.js";
import { renderPage } from "./template.js";

function explanation(overrides: Partial<CategoryExplanation> = {}): CategoryExplanation {
  return {
    category: {
      id: "c1",
      name: "Auth",
      description: "Authentication changes",
      attention: "normal",
    },
    markdown: "## What changed\n\nDoes the thing.\n\n## Tests\n\nTests the thing.\n",
    ...overrides,
  };
}

describe("renderPage", () => {
  it("renders the PR header with title, description and link", () => {
    const html = renderPage({
      prTitle: "Add retry logic",
      prDescription: "Retries flaky requests.",
      prUrl: "https://github.com/acme/widgets/pull/7",
      fileDiffs: new Map(),
      explanations: [],
    });
    const root = parse(html);
    expect(root.querySelector("h1")?.text).toBe("Add retry logic");
    expect(root.querySelector("#pr-description")?.text).toContain("Retries flaky requests.");
    expect(root.querySelector(".pr-link a")?.getAttribute("href")).toBe(
      "https://github.com/acme/widgets/pull/7",
    );
  });

  it("renders the PR's original description as its own labeled section, before the analysis, with a TOC entry", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "Retries flaky requests.",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({ category: { id: "c1", name: "Auth", description: "", attention: "normal" } }),
      ],
    });
    const root = parse(html);
    const section = root.querySelector("#pr-description");
    expect(section).not.toBeNull();
    expect(section?.querySelector("h2")?.text).toBe("Original PR description");
    expect(section?.text).toContain("Retries flaky requests.");
    // No longer nested inside the PR header — it's its own section now, and its body renders
    // as direct section children (like a category's does), not wrapped in an extra div — see
    // style.css's breakout selector, which only targets direct children.
    expect(root.querySelector("#pr-header")?.text).not.toContain("Retries flaky requests.");
    // Comes before the first category section in document order.
    const sectionsInOrder = root.querySelectorAll("#pr-description, .category");
    expect(sectionsInOrder[0]?.id).toBe("pr-description");
    // First entry in the floating TOC, ahead of the category entries.
    const tocLinks = root.querySelector("#toc")?.querySelectorAll("a") ?? [];
    expect(tocLinks[0]?.getAttribute("href")).toBe("#pr-description");
    expect(tocLinks[0]?.text).toBe("Original PR description");
  });

  it("renders the PR description's body as direct section children, like a category's, not wrapped in an extra div", () => {
    const ref = serializeSnippetRef({
      path: "src/a.ts",
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const rows = buildAlignedDiff("a\n", "a\n");
    const fileDiffs = new Map<string, FileDiffData>([["src/a.ts", { rows, embeddable: true }]]);
    const html = renderPage({
      prTitle: "t",
      prDescription: `Some prose.\n\n${ref}\n`,
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [],
    });
    const root = parse(html);
    const section = root.querySelector("#pr-description");
    const snippet = section?.querySelector(".snippet");
    // A grandchild (nested inside a wrapper div) would be invisible to style.css's breakout
    // selector, which only targets direct children — see docs/adr/0007's amendment.
    expect(snippet?.parentNode).toBe(section);
  });

  it("keeps headings and body content as direct children of their section, sharing the CSS grid's centered column", () => {
    const ref = serializeSnippetRef({
      path: "src/a.ts",
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const rows = buildAlignedDiff("a\n", "a\n");
    const fileDiffs = new Map<string, FileDiffData>([["src/a.ts", { rows, embeddable: true }]]);
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [
        explanation({
          markdown: `Intro paragraph.\n\n- one\n- two\n\n${ref}\n\n## What changed\n\nProd body.\n`,
        }),
      ],
    });
    const root = parse(html);
    const category = root.querySelector("#category-0");
    const introParagraph = category
      ?.querySelectorAll("p")
      .find((p) => p.text === "Intro paragraph.");
    const list = category?.querySelector("ul");
    const snippet = category?.querySelector(".snippet");
    const subsection = category?.querySelector(".subsection");
    // style.css's centered grid only positions DIRECT children into the shared content
    // column (see docs/adr/0007) — so the heading, an intro paragraph, and a list must all be
    // direct children of the section for their left edges to actually line up.
    expect(category?.querySelector("h2")?.parentNode).toBe(category);
    expect(introParagraph?.parentNode).toBe(category);
    expect(list?.parentNode).toBe(category);
    // The diff block and the subsection break out to the full grid span instead — still
    // direct children of the section, just given `grid-column: 1 / -1` in CSS.
    expect(snippet?.parentNode).toBe(category);
    expect(subsection?.parentNode).toBe(category);
  });

  it("renders no empty heading for a ## line that names nothing", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [explanation({ markdown: "Intro.\n\n## ###\n\nMore.\n" })],
    });
    const root = parse(html);
    // The count too, so this can't pass on a page that happens to have no headings at all.
    const headings = root.querySelectorAll("h2").map((h) => h.text.trim());
    expect(headings).toHaveLength(2);
    expect(headings).not.toContain("");
  });

  it("renders one section per category, in given order", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({
          category: { id: "c1", name: "First", description: "", attention: "normal" },
        }),
        explanation({
          category: { id: "c2", name: "Second", description: "", attention: "normal" },
        }),
      ],
    });
    const root = parse(html);
    const sections = root.querySelectorAll(".category");
    expect(sections).toHaveLength(2);
    // The name is the h2's own text node — its attention badge is a separate child element
    // (asserted by the attention-badge tests below), not part of the name text.
    expect(sections[0]?.querySelector("h2")?.childNodes[0]?.rawText.trim()).toBe("First");
    expect(sections[1]?.querySelector("h2")?.childNodes[0]?.rawText.trim()).toBe("Second");
    expect(sections[0]?.id).toBe("category-0");
    expect(sections[1]?.id).toBe("category-1");
  });

  it("renders a category's file tree at the top, before its body, and omits it when no files", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({
          files: [
            { path: "src/auth/login.ts", isTest: false },
            { path: "src/auth/login.test.ts", isTest: true },
          ],
        }),
        explanation({
          category: { id: "c2", name: "Other", description: "", attention: "normal" },
        }),
      ],
    });
    const root = parse(html);
    const sections = root.querySelectorAll(".category");
    const tree = sections[0]?.querySelector(".file-tree");
    expect(tree).not.toBeNull();
    expect(tree?.querySelector(".dir")?.text).toContain("src/auth");
    expect(tree?.querySelector(".file-tag")?.text).toBe("test");
    // The tree precedes the first subsection within the section's own markup.
    const sectionHtml = sections[0]?.outerHTML ?? "";
    expect(sectionHtml.indexOf('class="file-tree"')).toBeLessThan(
      sectionHtml.indexOf('class="subsection'),
    );
    // A category with no files renders no tree.
    expect(sections[1]?.querySelector(".file-tree")).toBeNull();
  });

  it("renders each category's attention badge in its section heading, with the right label and weight class", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({ category: { id: "c1", name: "Core", description: "", attention: "close" } }),
        explanation({
          category: { id: "c2", name: "Follow", description: "", attention: "normal" },
        }),
        explanation({ category: { id: "c3", name: "Wiring", description: "", attention: "skim" } }),
      ],
    });
    const root = parse(html);
    const sections = root.querySelectorAll(".category");
    const badge = (index: number) => sections[index]?.querySelector("h2 .attention-badge");
    expect(badge(0)?.text).toBe("Read closely");
    expect(badge(0)?.classNames).toContain("attention-close");
    expect(badge(1)?.text).toBe("Read through");
    expect(badge(1)?.classNames).toContain("attention-normal");
    expect(badge(2)?.text).toBe("Skim");
    expect(badge(2)?.classNames).toContain("attention-skim");
  });

  it("renders no attention badge on a subsection", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [explanation()],
    });
    const root = parse(html);
    expect(root.querySelector(".subsection .attention-badge")).toBeNull();
  });

  it("splits a category into subsections when the markdown has ## headings", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [explanation()],
    });
    const root = parse(html);
    const main = root.querySelector("#category-0-main-0");
    const test = root.querySelector("#category-0-test-1");
    expect(main?.querySelector("h3")?.text).toBe("What changed");
    expect(main?.text).toContain("Does the thing.");
    expect(test?.querySelector("h3")?.text).toBe("Tests");
    expect(test?.text).toContain("Tests the thing.");
  });

  it("folds a Tests section as a closed <details> around the subsection", () => {
    const ref = serializeSnippetRef({
      path: "src/a.test.ts",
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const rows = buildAlignedDiff("a\n", "a\n");
    const fileDiffs = new Map<string, FileDiffData>([
      ["src/a.test.ts", { rows, embeddable: true }],
    ]);
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [explanation({ markdown: `## What changed\n\nMain.\n\n## Tests\n\n${ref}\n` })],
    });
    const root = parse(html);
    const main = root.querySelector("#category-0-main-0");
    const test = root.querySelector("#category-0-test-1");
    expect(main?.tagName).toBe("DIV");
    expect(test?.tagName).toBe("DETAILS");
    expect(test?.hasAttribute("open")).toBe(false);
    expect(test?.classList.contains("section-fold")).toBe(true);
    expect(test?.querySelector("summary > h3")).not.toBeNull();
    expect(test?.querySelector(".subsection.subsection-test")).not.toBeNull();
  });

  it("keeps a snippet's own unfold flag inside a folded Tests section", () => {
    const ref = serializeSnippetRef({
      path: "src/a.test.ts",
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const rows = buildAlignedDiff("a\n", "a\n");
    const fileDiffs = new Map<string, FileDiffData>([
      ["src/a.test.ts", { rows, embeddable: true }],
    ]);
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [explanation({ markdown: `Intro.\n\n## Tests\n\n${ref}\n` })],
    });
    const test = parse(html).querySelector("#category-0-test-0");
    expect(test?.tagName).toBe("DETAILS");
    expect(test?.querySelector(".snippet details")?.hasAttribute("open")).toBe(true);
  });

  it("renders Tests and Documentation open when the category has no main content", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({ markdown: "\n## Tests\n\nOnly tests here.\n\n## Documentation\n\nDocs.\n" }),
      ],
    });
    const root = parse(html);
    expect(root.querySelector("#category-0-test-0")?.tagName).toBe("DIV");
    expect(root.querySelector("#category-0-docs-1")?.tagName).toBe("DIV");
    expect(root.querySelector("details.section-fold")).toBeNull();
  });

  it("gives duplicate same-kind subsections distinct ids instead of colliding", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({
          markdown:
            "## First part\n\nFirst part.\n\n## Tests\n\nT\n\n## Second part\n\nSecond part.\n",
        }),
      ],
    });
    const root = parse(html);
    const mainSections = root.querySelectorAll('[id^="category-0-main"]');
    expect(mainSections).toHaveLength(2);
    expect(mainSections[0]?.id).toBe("category-0-main-0");
    expect(mainSections[1]?.id).toBe("category-0-main-2");
    expect(root.querySelector("#category-0-main-0")?.text).toContain("First part.");
    expect(root.querySelector("#category-0-main-2")?.text).toContain("Second part.");
  });

  it("does not force subsections when the markdown has none", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [explanation({ markdown: "Just some prose, no headings." })],
    });
    const root = parse(html);
    expect(root.querySelector("#category-0-main-0")).toBeNull();
    expect(root.querySelector("#category-0-test-1")).toBeNull();
    expect(root.querySelector("#category-0")?.text).toContain("Just some prose, no headings.");
  });

  it("renders the intro (text before the first subsection heading) alongside the subsections, not instead of them", () => {
    const ref = serializeSnippetRef({
      path: "src/a.ts",
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const rows = buildAlignedDiff("a\n", "a\n");
    const fileDiffs = new Map<string, FileDiffData>([["src/a.ts", { rows, embeddable: true }]]);

    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [
        explanation({
          markdown: `Intro prose.\n\n\`\`\`mermaid\ngraph TD\nA --> B\n\`\`\`\n\n${ref}\n\n## What changed\n\nProd body.\n\n## Tests\n\nTest body.\n`,
        }),
      ],
    });

    const root = parse(html);
    const category = root.querySelector("#category-0");
    expect(category?.text).toContain("Intro prose.");
    expect(category?.querySelector("pre.mermaid")).not.toBeNull();
    expect(category?.querySelector(".snippet")).not.toBeNull();
    // ...and the subsections still render too.
    expect(root.querySelector("#category-0-main-0")?.text).toContain("Prod body.");
    expect(root.querySelector("#category-0-test-1")?.text).toContain("Test body.");
  });

  it("includes a TOC entry per category and per present subsection", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({ category: { id: "c1", name: "Auth", description: "", attention: "normal" } }),
        explanation({
          category: { id: "c1", name: "Logging", description: "", attention: "normal" },
          markdown: "Just prose.",
        }),
      ],
    });
    const root = parse(html);
    const toc = root.querySelector("#toc");
    expect(toc).not.toBeNull();
    const links = toc?.querySelectorAll("a").map((a) => a.getAttribute("href")) ?? [];
    expect(links).toEqual([
      "#pr-description",
      "#category-0",
      "#category-0-main-0",
      "#category-0-test-1",
      "#category-1",
    ]);
    // Guards against the TOC and the section markup ever deriving ids independently again (see
    // ./toc.ts's `buildToc` doc comment).
    for (const href of links) {
      expect(root.querySelector(href ?? "")).not.toBeNull();
    }
  });

  it("turns mermaid fences into diagram placeholders and embeds their sources", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({
          markdown: "## What changed\n\n```mermaid\ngraph TD\nA --> B\n```\n",
        }),
      ],
    });
    const root = parse(html);
    const pre = root.querySelector("pre.mermaid");
    expect(pre?.getAttribute("data-mermaid-index")).toBe("0");
    const sourcesScript = root.querySelector("#tulip-mermaid-sources");
    expect(sourcesScript).not.toBeNull();
    const sources = JSON.parse(sourcesScript?.text ?? "[]");
    expect(sources).toEqual(["graph TD\nA --> B"]);
  });

  it("substitutes a {{snippet}} marker with a side-by-side diff block", () => {
    const ref = serializeSnippetRef({
      path: "src/a.ts",
      head: { start: 2, end: 2 },
      unfold: false,
    });
    const rows = buildAlignedDiff("a\nb\nc\n", "a\nB\nc\n");
    const fileDiffs = new Map<string, FileDiffData>([["src/a.ts", { rows, embeddable: true }]]);

    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [
        explanation({
          markdown: `## What changed\n\n${ref}\n`,
        }),
      ],
    });

    const root = parse(html);
    expect(root.querySelector(".snippet")).not.toBeNull();
    expect(html).not.toContain("{{snippet");
    const fileDataScript = root.querySelector("#tulip-file-data");
    const embedded = JSON.parse(fileDataScript?.text ?? "{}");
    expect(embedded["src/a.ts"]).toEqual(rows);
  });

  it("omits embedded row data for a file over the embed-size cap", () => {
    const ref = serializeSnippetRef({
      path: "src/big.ts",
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const rows = buildAlignedDiff("a\n", "a\n");
    const fileDiffs = new Map<string, FileDiffData>([["src/big.ts", { rows, embeddable: false }]]);

    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [explanation({ markdown: `## What changed\n\n${ref}\n` })],
    });

    const root = parse(html);
    const embedded = JSON.parse(root.querySelector("#tulip-file-data")?.text ?? "{}");
    expect(embedded["src/big.ts"]).toBeUndefined();
    expect(root.querySelectorAll(".snippet-gap-btn")).toHaveLength(0);
  });

  it("carries a highlight.js language-class hook for a fenced code block in prose", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({
          markdown: "## What changed\n\n```ts\nconst x = 1;\n```\n",
        }),
      ],
    });
    // node-html-parser treats `<pre>` content as opaque text by default (no nested-element
    // querying), so this checks the raw markup directly rather than parsing it.
    expect(html).toContain('<pre><code class="language-ts">');
  });

  it("carries the diff's guessed language as a data attribute for the client-side highlighter", () => {
    const ref = serializeSnippetRef({
      path: "src/a.ts",
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const rows = buildAlignedDiff("a\n", "a\n");
    const fileDiffs = new Map<string, FileDiffData>([["src/a.ts", { rows, embeddable: true }]]);

    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [explanation({ markdown: `## What changed\n\n${ref}\n` })],
    });

    expect(parse(html).querySelector(".snippet")?.getAttribute("data-lang")).toBe("typescript");
  });

  it("carries theme-toggle and asset hooks with no network references", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [],
    });
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain('href="assets/style.css"');
    expect(html).toContain('src="assets/vendor/mermaid.min.js"');
    expect(html).toContain('src="assets/vendor/highlight.min.js"');
    expect(html).toContain('src="assets/app.js"');
    expect(html).not.toMatch(/https?:\/\/(?!github\.com)/);
    expect(html).not.toContain("cdn.");
  });

  it("renders a footer crediting the given build/version line", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [],
      generatedBy: "Tulip 0.1.0 (5d6fe0d, built 2026-08-31T18:49:05.783Z)",
    });
    const root = parse(html);
    const footer = root.querySelector("#page-footer");
    expect(footer?.text).toContain(
      "Generated by Tulip 0.1.0 (5d6fe0d, built 2026-08-31T18:49:05.783Z)",
    );
  });

  it("renders the footer with a plain fallback line when generatedBy is omitted (e.g. the dev fallback)", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [],
    });
    expect(html).toContain("Generated by");
  });

  it("renders one review box per category when serve is true", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      serve: true,
      explanations: [
        explanation({
          category: { id: "c1", name: "First", description: "", attention: "normal" },
        }),
        explanation({
          category: { id: "c2", name: "Second", description: "", attention: "normal" },
        }),
        explanation({
          category: { id: "c3", name: "Third", description: "", attention: "normal" },
        }),
      ],
    });
    const root = parse(html);
    const boxes = root.querySelectorAll(".review-box");
    expect(boxes).toHaveLength(3);
    // Each box carries its category's array-position index (0..n-1), matching categoryId(index)
    // and what the server validates categoryIndex against.
    expect(boxes.map((box) => box.getAttribute("data-category-index"))).toEqual(["0", "1", "2"]);
    // The box sits inside its own category section.
    for (let index = 0; index < 3; index++) {
      expect(root.querySelector(`#category-${index} .review-box`)).not.toBeNull();
    }
  });

  it("renders no review box when serve is false or omitted", () => {
    const base = {
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [explanation()],
    };
    expect(renderPage(base)).not.toContain("review-box");
    expect(renderPage({ ...base, serve: false })).not.toContain("review-box");
  });
});

describe("renderPage XSS safety", () => {
  it("escapes a <script> tag in the PR title, description and URL", () => {
    const html = renderPage({
      prTitle: '<script>alert("title")</script>',
      prDescription: "before <script>alert(1)</script> after",
      prUrl: 'https://github.com/a/b/pull/1"><script>alert(2)</script>',
      fileDiffs: new Map(),
      explanations: [],
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a <script> tag in a category's name and description", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({
          category: {
            id: "c1",
            name: "<script>alert(1)</script>",
            description: "<img src=x onerror=1>",
            attention: "normal",
          },
          markdown: "Body.",
        }),
      ],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=1>");
  });

  it("escapes untrusted content inside the embedded mermaid-sources JSON, including a closing </script> sequence", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({
          markdown:
            "## What changed\n\n```mermaid\ngraph TD\nA[</script><script>alert(1)</script>]\n```\n",
        }),
      ],
    });
    // The literal text must not produce a real closing tag followed by a new <script> element.
    expect(html).not.toMatch(/<\/script>\s*<script>alert\(1\)/);
    const root = parse(html);
    const sources = JSON.parse(root.querySelector("#tulip-mermaid-sources")?.text ?? "[]");
    expect(sources[0]).toContain("<script>alert(1)</script>");
  });

  it("escapes untrusted file content inside the embedded file-data JSON, including a closing </script> sequence", () => {
    const ref = serializeSnippetRef({
      path: "src/a.ts",
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const rows = buildAlignedDiff(
      "</script><script>alert(1)</script>\n",
      "</script><script>alert(1)</script>\n",
    );
    const fileDiffs = new Map<string, FileDiffData>([["src/a.ts", { rows, embeddable: true }]]);

    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [explanation({ markdown: `## What changed\n\n${ref}\n` })],
    });

    expect(html).not.toMatch(/<\/script>\s*<script>alert\(1\)/);
    // The snippet block itself (server-rendered HTML, not JSON) must have the tag escaped too.
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes a snippet ref's file path when used as an HTML attribute", () => {
    // The same raw path is also embedded in the #tulip-file-data <script> JSON below — that's
    // safe as-is (script element content isn't parsed as markup by the browser), so this test
    // checks the attribute specifically rather than asserting on the whole page string.
    const path = "src/<img src=x onerror=1>.ts";
    const ref = serializeSnippetRef({
      path,
      head: { start: 1, end: 1 },
      unfold: true,
    });
    const rows = buildAlignedDiff("a\n", "a\n");
    const fileDiffs = new Map<string, FileDiffData>([[path, { rows, embeddable: true }]]);

    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [explanation({ markdown: `## What changed\n\n${ref}\n` })],
    });

    const container = parse(html).querySelector(".snippet");
    expect(container?.getAttribute("data-path")).toBe(path);
    expect(container?.outerHTML).not.toContain("<img src=x onerror=1>");
  });

  it("escapes a <script> tag in the footer's generatedBy line", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [],
      generatedBy: '<script>alert("version")</script>',
    });

    expect(html).not.toContain('<script>alert("version")</script>');
    expect(html).toContain("&lt;script&gt;alert(&quot;version&quot;)&lt;/script&gt;");
  });
});
