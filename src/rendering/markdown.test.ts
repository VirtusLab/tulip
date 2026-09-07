import { describe, expect, it } from "vitest";
import { serializeSnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import {
  type MarkdownRenderContext,
  renderCategoryMarkdown,
  renderProseMarkdown,
} from "./markdown.js";

function context(
  fileDiffs: Map<string, FileDiffData> = new Map(),
  categoryRefTargets: MarkdownRenderContext["categoryRefTargets"] = new Map(),
): MarkdownRenderContext {
  return { mermaidSources: [], fileDiffs, categoryRefTargets };
}

describe("renderProseMarkdown", () => {
  it("renders standard markdown constructs", () => {
    const html = renderProseMarkdown("# Title\n\nSome **bold** and *em* text.\n\n- one\n- two\n");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("escapes raw HTML in the source instead of passing it through", () => {
    const html = renderProseMarkdown("Before <script>alert(1)</script> after.");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes raw HTML block tokens too", () => {
    const html = renderProseMarkdown("<img src=x onerror=alert(1)>\n\nSome text.\n");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });

  it("escapes content inside fenced code blocks", () => {
    const html = renderProseMarkdown("```\n<script>alert(1)</script>\n```\n");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps a normal http(s) link and image working", () => {
    const html = renderProseMarkdown(
      "[docs](https://example.com/page) and ![alt text](https://example.com/pic.png)",
    );
    expect(html).toContain('<a href="https://example.com/page">docs</a>');
    expect(html).toContain('<img src="https://example.com/pic.png" alt="alt text">');
  });

  it("keeps a relative/fragment link working", () => {
    const html = renderProseMarkdown("[section](#category-0) and [file](./readme.md)");
    expect(html).toContain('<a href="#category-0">section</a>');
    expect(html).toContain('<a href="./readme.md">file</a>');
  });

  it("neutralizes a javascript: link — drops the href, keeps the text", () => {
    const html = renderProseMarkdown("[click me](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
    expect(html).toContain("click me");
  });

  it("neutralizes a javascript: image — omits the <img> entirely", () => {
    const html = renderProseMarkdown("![x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
  });

  it("neutralizes a javascript: autolink", () => {
    const html = renderProseMarkdown("<javascript:alert(1)>");
    expect(html).not.toContain("javascript:alert(1)</a>");
    expect(html).not.toContain('href="javascript:');
  });

  it("neutralizes a data: image", () => {
    const html = renderProseMarkdown("![x](data:text/html;base64,abc123)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data:text/html");
  });
});

describe("renderCategoryMarkdown", () => {
  it("renders prose normally and turns a mermaid fence into a diagram placeholder", () => {
    const ctx = context();
    const html = renderCategoryMarkdown(
      "Some **prose**.\n\n```mermaid\ngraph TD\nA --> B\n```\n\nMore prose.",
      ctx,
    );
    expect(html).toContain("<strong>prose</strong>");
    expect(html).toContain("More prose.");
    expect(html).toContain('<pre class="mermaid" data-mermaid-index="0">');
    expect(html).not.toContain("```mermaid");
    expect(ctx.mermaidSources).toEqual(["graph TD\nA --> B"]);
  });

  it("assigns sequential mermaid indices across multiple calls sharing the same context", () => {
    const ctx = context();
    renderCategoryMarkdown("```mermaid\nA\n```\n", ctx);
    const second = renderCategoryMarkdown("```mermaid\nB\n```\n", ctx);
    expect(second).toContain('data-mermaid-index="1"');
    expect(ctx.mermaidSources).toEqual(["A", "B"]);
  });

  it("leaves markdown with no mermaid fences or snippet refs unaffected", () => {
    const ctx = context();
    const html = renderCategoryMarkdown("Just *text*.", ctx);
    expect(html).toBe("<p>Just <em>text</em>.</p>\n");
    expect(ctx.mermaidSources).toEqual([]);
  });

  it("turns a {{snippet}} marker into a diff block, not prose", () => {
    const ref = serializeSnippetRef({
      path: "src/a.ts",
      side: "head",
      lines: { start: 1, end: 1 },
      unfold: true,
    });
    const fileDiffs = new Map<string, FileDiffData>([
      [
        "src/a.ts",
        {
          embeddable: true,
          rows: [
            {
              baseLine: 1,
              baseText: "x",
              baseType: "context",
              headLine: 1,
              headText: "x",
              headType: "context",
            },
          ],
        },
      ],
    ]);
    const html = renderCategoryMarkdown(`Intro.\n\n${ref}\n\nOutro.`, context(fileDiffs));
    expect(html).toContain("Intro.");
    expect(html).toContain("Outro.");
    expect(html).toContain('class="snippet"');
    expect(html).not.toContain("{{snippet");
  });

  it("rewrites an inline {{catref}} to a link into the owning category's section, sentence intact", () => {
    // Rendering it as an <a> (not stripped to plain text) also proves the produced
    // "#category-1" fragment href passed the prose renderer's safety check.
    const targets = new Map([["c2", { index: 1, title: "Retry logic" }]]);
    const html = renderCategoryMarkdown(
      'See the {{catref id="c2"}} section for details.',
      context(new Map(), targets),
    );
    expect(html).toContain('<a href="#category-1">Retry logic</a>');
    expect(html).toContain("See the");
    expect(html).toContain("section for details.");
    // One paragraph — the inline link didn't split the sentence into separate blocks.
    expect(html.match(/<p>/g)).toHaveLength(1);
    expect(html).not.toContain("{{catref");
  });

  it("leaves an unknown {{catref}} id as literal text — no link, no throw", () => {
    const targets = new Map([["c2", { index: 1, title: "Retry logic" }]]);
    const html = renderCategoryMarkdown(
      'Refers to {{catref id="c9"}} here.',
      context(new Map(), targets),
    );
    expect(html).not.toContain("<a ");
    expect(html).toContain("catref");
    expect(html).toContain("c9");
  });

  it("forces a {{snippet}}'s details closed when forceSnippetsCollapsed is set, even with unfold=yes", () => {
    const ref = serializeSnippetRef({
      path: "src/a.ts",
      side: "head",
      lines: { start: 1, end: 1 },
      unfold: true,
    });
    const fileDiffs = new Map<string, FileDiffData>([
      [
        "src/a.ts",
        {
          embeddable: true,
          rows: [
            {
              baseLine: 1,
              baseText: "x",
              baseType: "context",
              headLine: 1,
              headText: "x",
              headType: "context",
            },
          ],
        },
      ],
    ]);
    const html = renderCategoryMarkdown(ref, context(fileDiffs), {
      forceSnippetsCollapsed: true,
    });
    expect(html).not.toContain("<details open>");
  });
});
