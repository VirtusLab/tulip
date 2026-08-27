import { describe, expect, it } from "vitest";
import { findMermaidFences, renderMermaidPlaceholder } from "./mermaid.js";

describe("findMermaidFences", () => {
  it("finds a mermaid fence with its source and span", () => {
    const markdown = "Before.\n\n```mermaid\ngraph TD\nA --> B\n```\n\nAfter.";
    const matches = findMermaidFences(markdown);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source).toBe("graph TD\nA --> B");
    expect(markdown.slice(matches[0]?.start, matches[0]?.end)).toBe(
      "```mermaid\ngraph TD\nA --> B\n```",
    );
  });

  it("finds multiple fences in document order", () => {
    const markdown = "```mermaid\nA\n```\n\ntext\n\n```mermaid\nB\n```\n";
    const matches = findMermaidFences(markdown);
    expect(matches.map((m) => m.source)).toEqual(["A", "B"]);
  });

  it("ignores non-mermaid fenced code blocks", () => {
    const markdown = "```ts\nconst x = 1;\n```\n";
    expect(findMermaidFences(markdown)).toEqual([]);
  });

  it("returns nothing when there are no fences", () => {
    expect(findMermaidFences("just prose")).toEqual([]);
  });
});

describe("renderMermaidPlaceholder", () => {
  it("renders a pre.mermaid element carrying the source and index", () => {
    const html = renderMermaidPlaceholder("graph TD\nA --> B", 3);
    expect(html).toBe('<pre class="mermaid" data-mermaid-index="3">graph TD\nA --&gt; B</pre>');
  });

  it("escapes HTML-significant characters in the source", () => {
    const html = renderMermaidPlaceholder("A[<script>]", 0);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
