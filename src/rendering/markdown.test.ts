import { describe, expect, it } from "vitest";
import { renderCategoryMarkdown, renderProseMarkdown } from "./markdown.js";

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
    const sources: string[] = [];
    const html = renderCategoryMarkdown(
      "Some **prose**.\n\n```mermaid\ngraph TD\nA --> B\n```\n\nMore prose.",
      sources,
    );
    expect(html).toContain("<strong>prose</strong>");
    expect(html).toContain("More prose.");
    expect(html).toContain('<pre class="mermaid" data-mermaid-index="0">');
    expect(html).not.toContain("```mermaid");
    expect(sources).toEqual(["graph TD\nA --> B"]);
  });

  it("assigns sequential indices across multiple calls sharing the same array", () => {
    const sources: string[] = [];
    renderCategoryMarkdown("```mermaid\nA\n```\n", sources);
    const second = renderCategoryMarkdown("```mermaid\nB\n```\n", sources);
    expect(second).toContain('data-mermaid-index="1"');
    expect(sources).toEqual(["A", "B"]);
  });

  it("leaves markdown with no mermaid fences unaffected", () => {
    const sources: string[] = [];
    const html = renderCategoryMarkdown("Just *text*.", sources);
    expect(html).toBe("<p>Just <em>text</em>.</p>\n");
    expect(sources).toEqual([]);
  });
});
