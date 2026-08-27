import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";
import { serializeSnippetRef } from "../explanations/markup.js";
import type { CategoryExplanation } from "../explanations/types.js";
import type { FileDiffData } from "./file-diffs.js";
import { buildAlignedDiff } from "./line-diff.js";
import { renderPage } from "./template.js";

function explanation(overrides: Partial<CategoryExplanation> = {}): CategoryExplanation {
  return {
    category: { name: "Auth", description: "Authentication changes" },
    markdown: "## Production code\n\nDoes the thing.\n\n## Test code\n\nTests the thing.\n",
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
    expect(root.querySelector(".pr-description")?.text).toContain("Retries flaky requests.");
    expect(root.querySelector(".pr-link a")?.getAttribute("href")).toBe(
      "https://github.com/acme/widgets/pull/7",
    );
  });

  it("renders one section per category, in given order", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({ category: { name: "First", description: "" } }),
        explanation({ category: { name: "Second", description: "" } }),
      ],
    });
    const root = parse(html);
    const sections = root.querySelectorAll(".category");
    expect(sections).toHaveLength(2);
    expect(sections[0]?.querySelector("h2")?.text).toBe("First");
    expect(sections[1]?.querySelector("h2")?.text).toBe("Second");
    expect(sections[0]?.id).toBe("category-0");
    expect(sections[1]?.id).toBe("category-1");
  });

  it("splits a category into Production/Test subsections when the markdown has them", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [explanation()],
    });
    const root = parse(html);
    const production = root.querySelector("#category-0-production-0");
    const test = root.querySelector("#category-0-test-1");
    expect(production?.querySelector("h3")?.text).toBe("Production code");
    expect(production?.text).toContain("Does the thing.");
    expect(test?.querySelector("h3")?.text).toBe("Test code");
    expect(test?.text).toContain("Tests the thing.");
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
            "## Production code\n\nFirst part.\n\n## Test code\n\nT\n\n## Production code\n\nSecond part.\n",
        }),
      ],
    });
    const root = parse(html);
    const productionSections = root.querySelectorAll('[id^="category-0-production"]');
    expect(productionSections).toHaveLength(2);
    expect(productionSections[0]?.id).toBe("category-0-production-0");
    expect(productionSections[1]?.id).toBe("category-0-production-2");
    expect(root.querySelector("#category-0-production-0")?.text).toContain("First part.");
    expect(root.querySelector("#category-0-production-2")?.text).toContain("Second part.");

    const toc = root.querySelector("#toc");
    const hrefs = toc?.querySelectorAll("a").map((a) => a.getAttribute("href")) ?? [];
    expect(hrefs).toEqual([
      "#category-0",
      "#category-0-production-0",
      "#category-0-test-1",
      "#category-0-production-2",
    ]);
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
    expect(root.querySelector("#category-0-production-0")).toBeNull();
    expect(root.querySelector("#category-0-test-1")).toBeNull();
    expect(root.querySelector("#category-0")?.text).toContain("Just some prose, no headings.");
  });

  it("renders the intro (text before the first subsection heading) alongside the subsections, not instead of them", () => {
    const ref = serializeSnippetRef({
      path: "src/a.ts",
      side: "head",
      lines: { start: 1, end: 1 },
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
          markdown: `Intro prose.\n\n\`\`\`mermaid\ngraph TD\nA --> B\n\`\`\`\n\n${ref}\n\n## Production code\n\nProd body.\n\n## Test code\n\nTest body.\n`,
        }),
      ],
    });

    const root = parse(html);
    const category = root.querySelector("#category-0");
    expect(category?.text).toContain("Intro prose.");
    expect(category?.querySelector("pre.mermaid")).not.toBeNull();
    expect(category?.querySelector(".snippet")).not.toBeNull();
    // ...and the subsections still render too.
    expect(root.querySelector("#category-0-production-0")?.text).toContain("Prod body.");
    expect(root.querySelector("#category-0-test-1")?.text).toContain("Test body.");
  });

  it("includes a TOC entry per category and per present subsection", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({ category: { name: "Auth", description: "" } }),
        explanation({
          category: { name: "Logging", description: "" },
          markdown: "Just prose.",
        }),
      ],
    });
    const root = parse(html);
    const toc = root.querySelector("#toc");
    expect(toc).not.toBeNull();
    const links = toc?.querySelectorAll("a").map((a) => a.getAttribute("href")) ?? [];
    expect(links).toEqual([
      "#category-0",
      "#category-0-production-0",
      "#category-0-test-1",
      "#category-1",
    ]);
  });

  it("turns mermaid fences into diagram placeholders and embeds their sources", () => {
    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs: new Map(),
      explanations: [
        explanation({
          markdown: "## Production code\n\n```mermaid\ngraph TD\nA --> B\n```\n",
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
      side: "head",
      lines: { start: 2, end: 2 },
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
          markdown: `## Production code\n\n${ref}\n`,
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
      side: "head",
      lines: { start: 1, end: 1 },
      unfold: true,
    });
    const rows = buildAlignedDiff("a\n", "a\n");
    const fileDiffs = new Map<string, FileDiffData>([["src/big.ts", { rows, embeddable: false }]]);

    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [explanation({ markdown: `## Production code\n\n${ref}\n` })],
    });

    const root = parse(html);
    const embedded = JSON.parse(root.querySelector("#tulip-file-data")?.text ?? "{}");
    expect(embedded["src/big.ts"]).toBeUndefined();
    expect(root.querySelectorAll(".snippet-expand")).toHaveLength(0);
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
    expect(html).toContain('src="assets/app.js"');
    expect(html).not.toMatch(/https?:\/\/(?!github\.com)/);
    expect(html).not.toContain("cdn.");
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
          category: { name: "<script>alert(1)</script>", description: "<img src=x onerror=1>" },
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
            "## Production code\n\n```mermaid\ngraph TD\nA[</script><script>alert(1)</script>]\n```\n",
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
      side: "head",
      lines: { start: 1, end: 1 },
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
      explanations: [explanation({ markdown: `## Production code\n\n${ref}\n` })],
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
      side: "head",
      lines: { start: 1, end: 1 },
      unfold: true,
    });
    const rows = buildAlignedDiff("a\n", "a\n");
    const fileDiffs = new Map<string, FileDiffData>([[path, { rows, embeddable: true }]]);

    const html = renderPage({
      prTitle: "t",
      prDescription: "d",
      prUrl: "https://github.com/a/b/pull/1",
      fileDiffs,
      explanations: [explanation({ markdown: `## Production code\n\n${ref}\n` })],
    });

    const container = parse(html).querySelector(".snippet");
    expect(container?.getAttribute("data-path")).toBe(path);
    expect(container?.outerHTML).not.toContain("<img src=x onerror=1>");
  });
});
