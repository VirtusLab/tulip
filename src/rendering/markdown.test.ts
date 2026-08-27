import { describe, expect, it } from "vitest";
import { serializeSnippetRef } from "../explanations/markup.js";
import type { FileDiffData } from "./file-diffs.js";
import {
  type MarkdownRenderContext,
  renderCategoryMarkdown,
  renderProseMarkdown,
} from "./markdown.js";

function context(fileDiffs: Map<string, FileDiffData> = new Map()): MarkdownRenderContext {
  return { mermaidSources: [], fileDiffs };
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
});
